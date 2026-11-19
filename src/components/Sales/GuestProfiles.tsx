import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  RefreshCw,
  Users,
  Star,
  Calendar,
  Heart,
  Search,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import StatCard from '../FrontOffice/StatCard';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { DataTable, Column } from '../Shared/DataTable';
import { ModalSystem } from '../Shared/ModalSystem';
import {
  fetchGuestProfiles,
  createGuestProfile,
  type GuestProfileRecord,
} from '../../services/salesService';

const LOYALTY_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];

const ROOM_PREFERENCES = ['Standard', 'Deluxe', 'Suite', 'Executive'];
const DIETARY_PREFERENCES = ['None', 'Vegetarian', 'Vegan', 'Halal', 'Gluten-Free', 'Kosher'];

const TIER_TONE: Record<string, string> = {
  diamond: 'accent',
  platinum: 'info',
  gold: 'warning',
  silver: 'success',
  bronze: 'neutral',
};

const TIER_POINTS: Record<string, number> = {
  Bronze: 0,
  Silver: 1000,
  Gold: 2500,
  Platinum: 5000,
  Diamond: 10000,
};

interface GuestProfileRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  loyaltyStatus: string;
  totalStays: number;
  totalSpend: number;
  roomPreference: string;
  dietaryPreference: string;
  specialRequests: string;
  notes: string;
  lastStay: string | null;
}

function tierLabel(tier: string) {
  if (!tier || tier === 'none') return 'Bronze';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  loyaltyStatus: 'Bronze',
  roomPreference: 'Standard',
  dietaryPreference: 'None',
  specialRequests: '',
  notes: '',
};

const GuestProfiles: React.FC = () => {
  const { addNotification, formatAmount } = useERP();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<GuestProfileRecord[]>([]);
  const [filterTier, setFilterTier] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGuestProfiles();
      setProfiles(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load guest profiles');
      addNotification('Failed to load guest profiles', 'error', 'Sales');
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => { loadData(); }, [loadData]);

  const rows = useMemo<GuestProfileRow[]>(() => {
    return profiles.map((p) => {
      const tier = tierLabel(p.history?.loyaltyTier || 'none');
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        email: p.email || '',
        phone: p.phone || '',
        status: p.status || 'Regular',
        loyaltyStatus: tier,
        totalStays: p.history?.totalStays || 0,
        totalSpend: p.history?.totalRevenue || 0,
        roomPreference: p.preferences?.roomType || 'Standard',
        dietaryPreference: p.preferences?.dietary || 'None',
        specialRequests: p.specialRequests || '',
        notes: p.notes || '',
        lastStay: p.history?.lastStay || null,
      };
    });
  }, [profiles]);

  const filtered = useMemo(() => {
    let data = rows;
    if (filterTier !== 'all') {
      data = data.filter((r) => r.loyaltyStatus === filterTier);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      data = data.filter((r) =>
        [r.name, r.email, r.phone, r.roomPreference, r.dietaryPreference].some((v) =>
          (v || '').toLowerCase().includes(q)
        )
      );
    }
    return data;
  }, [rows, filterTier, search]);

  const totalGuests = rows.length;
  const loyaltyMembers = rows.filter((r) =>
    ['Silver', 'Gold', 'Platinum', 'Diamond'].includes(r.loyaltyStatus)
  ).length;
  const totalStays = rows.reduce((s, r) => s + r.totalStays, 0);
  const totalSpend = rows.reduce((s, r) => s + r.totalSpend, 0);

  const handleAdd = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError('First name, last name, and email are required');
      return;
    }

    const loyaltyPoints = TIER_POINTS[form.loyaltyStatus] ?? 0;
    const status = loyaltyPoints >= 5000 ? 'VIP' : loyaltyPoints >= 1000 ? 'Loyalty Member' : 'Regular';

    setSaving(true);
    setError(null);
    try {
      await createGuestProfile({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        status,
        loyaltyPoints,
        preferences: {
          language: 'English',
          roomType: form.roomPreference,
          bedType: 'Queen',
          pillowType: 'Medium',
          dietary: form.dietaryPreference,
          newspaper: 'None',
          amenities: ['WiFi'],
        },
        notes: form.notes,
        specialRequests: form.specialRequests,
      });
      addNotification('Guest profile created', 'success', 'Sales');
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create guest profile');
      addNotification('Failed to create guest profile', 'error', 'Sales');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<GuestProfileRow>[] = [
    {
      key: 'name',
      label: 'Guest Name',
      sortable: true,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]">
            <Users size={14} />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.name}</span>
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      sortAccessor: (r) => r.email,
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.email || '—'}</span>,
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.phone || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.status,
      render: (r) => {
        const tone = r.status === 'VIP' ? 'accent' : r.status === 'Loyalty Member' ? 'info' : 'neutral';
        return <Badge tone={tone as any}>{r.status}</Badge>;
      },
    },
    {
      key: 'loyaltyStatus',
      label: 'Loyalty',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.loyaltyStatus,
      render: (r) => {
        const tone = TIER_TONE[r.loyaltyStatus.toLowerCase()] || 'neutral';
        return <Badge tone={tone as any}>{r.loyaltyStatus}</Badge>;
      },
    },
    {
      key: 'totalStays',
      label: 'Stays',
      align: 'right',
      sortable: true,
      sortAccessor: (r) => r.totalStays,
      render: (r) => <span className="text-sm text-slate-600 dark:text-slate-400">{r.totalStays}</span>,
    },
    {
      key: 'totalSpend',
      label: 'Spend',
      align: 'right',
      sortable: true,
      sortAccessor: (r) => r.totalSpend,
      render: (r) => <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatAmount(r.totalSpend)}</span>,
    },
    {
      key: 'roomPreference',
      label: 'Room',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.roomPreference,
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.roomPreference}</span>,
    },
    {
      key: 'dietaryPreference',
      label: 'Dietary',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.dietaryPreference,
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.dietaryPreference}</span>,
    },
    {
      key: 'lastStay',
      label: 'Last Stay',
      align: 'center',
      sortable: true,
      sortAccessor: (r) => r.lastStay || '',
      render: (r) => <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{r.lastStay || '—'}</span>,
    },
  ];

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        title="Guest Profiles"
        subtitle="360° guest preferences, stay history, and spend analysis · DB-synced"
        icon={Users}
        actions={
          <>
            <button onClick={loadData} disabled={loading} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowAddModal(true)} className={button.primary}>
              <Plus size={16} /> Add Guest
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-center justify-between">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p>
          <button onClick={loadData} disabled={loading} className={[button.secondary, 'flex items-center gap-2'].join(' ')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
      )}

      <div className={layout.kpiGrid}>
        <StatCard title="Total Guests" value={totalGuests.toLocaleString()} icon={Users} tone="accent" />
        <StatCard title="Loyalty Members" value={loyaltyMembers.toLocaleString()} icon={Star} tone="warning" />
        <StatCard title="Total Stays" value={totalStays.toLocaleString()} icon={Calendar} tone="info" />
        <StatCard title="Total Spend" value={formatAmount(totalSpend)} icon={DollarSign} tone="success" />
      </div>

      <SectionCard
        title="Guest Directory"
        subtitle="Filter by loyalty tier and search by name, email, or preference"
        actions={
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search guests..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        }
      >
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {LOYALTY_TIERS.map((tier) => {
              const count = rows.filter((r) => r.loyaltyStatus === tier).length;
              const active = filterTier === tier;
              return (
                <button
                  key={tier}
                  onClick={() => setFilterTier(active ? 'all' : tier)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                    active
                      ? `${statusTone[TIER_TONE[tier.toLowerCase()] as any]?.soft || statusTone.accent.soft} border-[var(--color-accent-operations)]/30`
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
                  }`}
                >
                  {tier} ({count})
                </button>
              );
            })}
            <button
              onClick={() => setFilterTier('all')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition border ${
                filterTier === 'all'
                  ? `${statusTone.accent.soft} border-[var(--color-accent-operations)]/30`
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-[var(--color-accent-operations)]/50'
              }`}
            >
              All ({rows.length})
            </button>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            rowKey={(row) => row.id}
            sortable
            pagination
            pageSize={10}
            emptyMessage="No guest profiles found."
            containerClassName="!rounded-2xl !shadow-none border-slate-200 dark:border-slate-700"
          />
        </div>
      </SectionCard>

      <ModalSystem
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setForm(EMPTY_FORM); setError(null); }}
        onConfirm={handleAdd}
        title="New Guest Profile"
        subtitle="Register a new guest with preferences and loyalty details"
        confirmLabel="Add Guest"
        cancelLabel="Cancel"
        confirmColor="emerald"
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">First Name</label>
              <input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Last Name</label>
              <input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Loyalty Tier</label>
              <select
                value={form.loyaltyStatus}
                onChange={(e) => setForm({ ...form, loyaltyStatus: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              >
                {LOYALTY_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Room Preference</label>
              <select
                value={form.roomPreference}
                onChange={(e) => setForm({ ...form, roomPreference: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              >
                {ROOM_PREFERENCES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Dietary Preference</label>
              <select
                value={form.dietaryPreference}
                onChange={(e) => setForm({ ...form, dietaryPreference: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              >
                {DIETARY_PREFERENCES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Special Requests</label>
            <input
              value={form.specialRequests}
              onChange={(e) => setForm({ ...form, specialRequests: e.target.value })}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              placeholder="e.g., quiet room, late checkout"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-2">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
            />
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default GuestProfiles;
