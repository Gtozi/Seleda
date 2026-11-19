import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, RefreshCw, Crown, Star, Gift,
  BedDouble, Utensils, Sparkles, Calendar,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { DataTable, Column } from '../Shared/DataTable';
import { fetchLoyaltyMembers, createLoyaltyMember, type LoyaltyMember } from '../../services/salesService';

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'];

const TIER_TONE: Record<string, string> = {
  Bronze: 'warning',
  Silver: 'neutral',
  Gold: 'warning',
  Platinum: 'accent',
};

const STATUS_TONE: Record<string, string> = {
  Active: 'success',
  Inactive: 'neutral',
  Suspended: 'danger',
};

const REWARDS = [
  { name: 'Free Nights', icon: BedDouble, points: 5000, color: 'bg-indigo-50 text-indigo-600' },
  { name: 'Room Upgrades', icon: Star, points: 3000, color: 'bg-purple-50 text-purple-600' },
  { name: 'Dining Rewards', icon: Utensils, points: 1500, color: 'bg-amber-50 text-amber-600' },
  { name: 'Spa Rewards', icon: Sparkles, points: 2500, color: 'bg-emerald-50 text-emerald-600' },
  { name: 'Exclusive Offers', icon: Gift, points: 1000, color: 'bg-rose-50 text-rose-600' },
];

const EMPTY_FORM = {
  memberName: '',
  tier: 'Bronze',
  points: 0,
  totalStays: 0,
  totalSpend: 0,
  rewardsRedeemed: 0,
  enrollmentDate: '',
  status: 'Active',
};

const LoyaltyManagement: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [members, setMembers] = useState<LoyaltyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await fetchLoyaltyMembers());
    } catch (err: any) {
      setError(err.message || 'Failed to load loyalty members');
      addNotification('Failed to load loyalty members', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!form.memberName.trim()) {
      setError('Member name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createLoyaltyMember(form);
      addNotification('Loyalty member enrolled', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to enroll member');
      addNotification('Failed to enroll member', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const tierCounts = useMemo(() => {
    const map: Record<string, number> = {};
    members.forEach((m) => { map[m.tier] = (map[m.tier] || 0) + 1; });
    return map;
  }, [members]);

  const totalPoints = useMemo(() => members.reduce((s, m) => s + Number(m.points || 0), 0), [members]);
  const totalSpend = useMemo(() => members.reduce((s, m) => s + Number(m.total_spend || 0), 0), [members]);
  const totalRewards = useMemo(() => members.reduce((s, m) => s + Number(m.rewards_redeemed || 0), 0), [members]);

  const columns: Column<LoyaltyMember>[] = [
    {
      key: 'member_name',
      label: 'Member',
      sortable: true,
      sortAccessor: (m) => m.member_name,
      render: (m) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-warning)]/10 text-[var(--color-warning)]"><Crown size={12} /></div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{m.member_name}</span>
        </div>
      ),
    },
    {
      key: 'tier',
      label: 'Tier',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.tier,
      render: (m) => <Badge tone={(TIER_TONE[m.tier] || 'neutral') as any}>{m.tier}</Badge>,
    },
    {
      key: 'points',
      label: 'Points',
      align: 'right',
      sortable: true,
      sortAccessor: (m) => m.points,
      render: (m) => <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{Number(m.points).toLocaleString()}</span>,
    },
    {
      key: 'total_stays',
      label: 'Stays',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.total_stays,
      render: (m) => <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">{m.total_stays}</span>,
    },
    {
      key: 'total_spend',
      label: 'Spend',
      align: 'right',
      sortable: true,
      sortAccessor: (m) => m.total_spend,
      render: (m) => <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatAmount(m.total_spend)}</span>,
    },
    {
      key: 'rewards_redeemed',
      label: 'Rewards',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.rewards_redeemed,
      render: (m) => <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">{m.rewards_redeemed}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.status,
      render: (m) => <Badge tone={(STATUS_TONE[m.status] || 'neutral') as any}>{m.status}</Badge>,
    },
    {
      key: 'enrollment_date',
      label: 'Enrolled',
      align: 'center',
      sortable: true,
      sortAccessor: (m) => m.enrollment_date || '',
      render: (m) => (
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">
          <Calendar size={12} /> {m.enrollment_date || '—'}
        </span>
      ),
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Loyalty Management"
        subtitle="Membership enrollment, tier management, points, rewards, and redemption · DB-synced"
        icon={Crown}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => { setForm(EMPTY_FORM); setShowAddModal(true); setError(null); }} className={button.primary}>
              <Plus size={16} /> Enroll Member
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {TIERS.map((tier) => (
          <StatCard
            key={tier}
            title={`${tier} Members`}
            value={(tierCounts[tier] || 0).toString()}
            icon={Crown}
            tone={(TIER_TONE[tier] || 'neutral') as any}
          />
        ))}
      </div>

      <div className={layout.kpiGrid}>
        <StatCard title="Total Members" value={members.length.toLocaleString()} icon={Crown} tone="info" />
        <StatCard title="Total Points" value={totalPoints.toLocaleString()} icon={Star} tone="warning" />
        <StatCard title="Total Spend" value={formatAmount(totalSpend)} icon={Gift} tone="success" />
        <StatCard title="Rewards Redeemed" value={totalRewards.toLocaleString()} icon={Gift} tone="accent" />
      </div>

      <SectionCard title="Reward Catalog" subtitle="Available loyalty redemptions">
        <div className="p-6 grid grid-cols-2 md:grid-cols-5 gap-4">
          {REWARDS.map((reward) => {
            const Icon = reward.icon;
            return (
              <div key={reward.name} className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800">
                <div className={`p-2 w-fit rounded-xl ${reward.color} mb-2`}><Icon size={16} /></div>
                <p className="text-xs font-black text-slate-900 dark:text-white">{reward.name}</p>
                <p className="text-[10px] font-bold text-amber-600 mt-1">{reward.points.toLocaleString()} pts</p>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Loyalty Members" subtitle="All enrolled members with tier and points">
        <div className="p-6">
          <DataTable
            columns={columns}
            data={members}
            rowKey={(row) => row.id}
            sortable
            filterable
            filterPlaceholder="Search members..."
            filterKeys={['member_name', 'tier', 'status']}
            emptyMessage="No loyalty members enrolled yet."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setError(null); }}
        onConfirm={handleCreate}
        title="Enroll Loyalty Member"
        subtitle="Register a new loyalty program member"
        confirmLabel="Enroll"
        cancelLabel="Cancel"
        confirmColor="amber"
        showFooter
        loading={saving}
        size="lg"
      >
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Member Name</label>
            <input value={form.memberName} onChange={(e) => setForm({ ...form, memberName: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Tier</label>
              <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Starting Points</label>
              <input type="number" value={form.points} onChange={(e) => setForm({ ...form, points: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Stays</label>
              <input type="number" value={form.totalStays} onChange={(e) => setForm({ ...form, totalStays: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Total Spend ($)</label>
              <input type="number" value={form.totalSpend} onChange={(e) => setForm({ ...form, totalSpend: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Rewards Redeemed</label>
              <input type="number" value={form.rewardsRedeemed} onChange={(e) => setForm({ ...form, rewardsRedeemed: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Enrollment Date</label>
              <input type="date" value={form.enrollmentDate} onChange={(e) => setForm({ ...form, enrollmentDate: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
            </div>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default LoyaltyManagement;
