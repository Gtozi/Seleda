/**
 * VIP Guest Management — Operations Portal (/erp/operations/vip-management).
 *
 * Live VIP roster built from real data across portals:
 *   guests (status VIP/Loyalty Member) + their reservations  — Front Office
 *   guest_requests (open)                                   — FO concierge queue
 *   transport_airport_transfers                             — Transport
 *   spa_appointments                                        — Spa
 *   housekeeping_task_mgmt (VIP prep)                       — Housekeeping
 *   ops_vip_profiles                                        — ops overrides (mig. 636)
 *
 * Category/butler/notification settings persist to ops_vip_profiles; "Raise
 * Request" writes a real guest_requests row visible to the Front Office.
 * UI follows the shared portal design language (PageHeader, SectionCard,
 * StatCard, Badge, brandTheme) — same as HK / Engineering / F&B modules.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Star,
  Crown,
  Building2,
  Briefcase,
  Award,
  Heart,
  Search,
  Plus,
  ChevronRight,
  Calendar,
  Utensils,
  Bell,
  CheckCircle2,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Plane,
  Sparkles,
  BedDouble,
  ClipboardList,
  Save,
  UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { button, layout, type StatusTone } from '../../FrontOffice/brandTheme';
import { useERP } from '../../../context/ERPContext';
import {
  fetchVipGuests,
  createVipGuest,
  updateVipProfile,
  createVipRequest,
  type VipGuest,
  type VipCategory,
  type VipGuestsOverview,
} from '../../../services/operationsService';

// ── Static maps ──────────────────────────────────────────────────────────

const CATEGORY_META: Record<VipCategory, { icon: LucideIcon; tone: StatusTone; chip: string }> = {
  'VVIP': { icon: Crown, tone: 'warning', chip: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  'VIP': { icon: Star, tone: 'info', chip: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  'Loyalty Elite': { icon: Award, tone: 'info', chip: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  'Corporate Executive': { icon: Building2, tone: 'neutral', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
  'Government Official': { icon: Briefcase, tone: 'success', chip: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' },
  'Celebrity': { icon: Heart, tone: 'danger', chip: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400' },
};
const CATEGORIES = Object.keys(CATEGORY_META) as VipCategory[];

const STAY_META: Record<VipGuest['status'], { label: string; tone: StatusTone }> = {
  arrived: { label: 'In-House', tone: 'success' },
  expected: { label: 'Expected', tone: 'info' },
  departed: { label: 'Departed', tone: 'neutral' },
};

const catMeta = (c: string) => CATEGORY_META[c as VipCategory] || CATEGORY_META.VIP;
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : '—');
const fmtDateTime = (d?: string) => (d ? new Date(d).toLocaleString() : '—');

// ── Component ────────────────────────────────────────────────────────────

const VIPGuestManagement: React.FC = () => {
  const { currentPropertyId, addNotification, formatAmount } = useERP();

  const [data, setData] = useState<VipGuestsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'all' | VipCategory>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | VipGuest['status']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Profile edit + raise-request forms (detail panel).
  const [editCategory, setEditCategory] = useState<VipCategory>('VIP');
  const [editButler, setEditButler] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editNotify, setEditNotify] = useState(true);
  const [reqDesc, setReqDesc] = useState('');
  const [reqType, setReqType] = useState('VIP Service');
  const [addForm, setAddForm] = useState({ name: '', category: 'VIP' as VipCategory, email: '', phone: '', nationality: '', butler: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchVipGuests(currentPropertyId);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load VIP guests');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const guests = data?.guests || [];
  const selectedGuest = guests.find((g) => g.id === selectedId) || null;

  useEffect(() => {
    if (selectedGuest) {
      setEditCategory(selectedGuest.category);
      setEditButler(selectedGuest.butlerAssigned || '');
      setEditNotes(selectedGuest.profileNotes || '');
      setEditNotify(selectedGuest.notifications);
      setReqDesc('');
    }
  }, [selectedId, data]);

  const filteredGuests = useMemo(() => guests.filter((guest) => {
    const matchesCategory = selectedCategory === 'all' || guest.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || guest.status === selectedStatus;
    const q = searchQuery.toLowerCase();
    const matchesSearch = q === '' ||
      guest.name.toLowerCase().includes(q) ||
      (guest.roomNumber && guest.roomNumber.toLowerCase().includes(q));
    return matchesCategory && matchesStatus && matchesSearch;
  }), [guests, selectedCategory, selectedStatus, searchQuery]);

  const saveProfile = async () => {
    if (!selectedGuest) return;
    setSaving(true);
    try {
      await updateVipProfile(selectedGuest.id, {
        category: editCategory,
        butler: editButler || undefined,
        notifications: editNotify,
        notes: editNotes || undefined,
        propertyId: currentPropertyId,
      });
      addNotification(`${selectedGuest.name}'s VIP profile was updated.`, 'task', 'Executive');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const raiseRequest = async () => {
    if (!selectedGuest || !reqDesc.trim()) return;
    setSaving(true);
    try {
      await createVipRequest(selectedGuest.id, {
        propertyId: currentPropertyId,
        type: reqType,
        description: reqDesc.trim(),
        priority: 'High',
        department: 'FO',
      });
      addNotification(`Guest request for ${selectedGuest.name} sent to Front Office.`, 'task', 'Executive');
      setReqDesc('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to raise request');
    } finally {
      setSaving(false);
    }
  };

  const submitAdd = async () => {
    if (!addForm.name.trim()) return;
    setSaving(true);
    try {
      await createVipGuest({ ...addForm, propertyId: currentPropertyId });
      addNotification(`${addForm.name} added to the VIP roster.`, 'task', 'Executive');
      setShowAdd(false);
      setAddForm({ name: '', category: 'VIP', email: '', phone: '', nationality: '', butler: '' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to add VIP guest');
    } finally {
      setSaving(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className={layout.sectionStack}>
      <PageHeader
        icon={Star}
        title="VIP Guest Management"
        subtitle="Live roster of VIP guests — arrivals, requests, transfers and prep across all departments"
        actions={
          <div className="flex items-center gap-2">
            <button className={button.ghost} onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button className={button.primary} onClick={() => setShowAdd((v) => !v)}>
              <Plus size={16} /> Add VIP Guest
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="VIP Guests" value={stats?.total ?? '—'} icon={Star} tone="accent" />
        <StatCard title="In-House" value={stats?.arrived ?? '—'} icon={BedDouble} tone="success" />
        <StatCard title="Expected Arrivals" value={stats?.expected ?? '—'} icon={Calendar} tone="info" />
        <StatCard title="Open VIP Requests" value={stats?.openRequests ?? '—'} icon={ClipboardList} tone="warning" />
      </div>

      {/* Add form */}
      {showAdd && (
        <SectionCard title="New VIP Guest" icon={Plus} pad="md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Guest name *" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            <select className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value as VipCategory }))}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} />
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Phone" value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} />
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Nationality" value={addForm.nationality} onChange={(e) => setAddForm((f) => ({ ...f, nationality: e.target.value }))} />
            <input className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" placeholder="Assigned butler" value={addForm.butler} onChange={(e) => setAddForm((f) => ({ ...f, butler: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className={button.ghost} onClick={() => setShowAdd(false)}>Cancel</button>
            <button className={button.primary} onClick={submitAdd} disabled={saving || !addForm.name.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create
            </button>
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search VIP guests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm focus:ring-1 focus:ring-[var(--color-accent-operations)] outline-none"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as any)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm outline-none"
        >
          <option value="all">All Status</option>
          <option value="arrived">In-House</option>
          <option value="expected">Expected</option>
          <option value="departed">Departed</option>
        </select>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
          <Loader2 size={20} className="animate-spin" /> Loading VIP roster…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Guest list */}
          <div className="lg:col-span-2 space-y-3">
            {filteredGuests.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                <Star size={48} className="text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">
                  {guests.length === 0 ? 'No VIP guests in the system' : 'No VIP guests match your filters'}
                </p>
              </div>
            ) : (
              filteredGuests.map((guest) => {
                const Icon = catMeta(guest.category).icon;
                const stay = STAY_META[guest.status];
                return (
                  <div
                    key={guest.id}
                    onClick={() => setSelectedId(guest.id)}
                    className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                      selectedId === guest.id
                        ? 'bg-[var(--color-accent-operations)]/5 border-[var(--color-accent-operations)]/40'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${catMeta(guest.category).chip}`}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="font-semibold text-slate-900 dark:text-white truncate">{guest.name}</h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                              {guest.roomNumber || 'No active reservation'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge tone={stay.tone}>{stay.label}</Badge>
                            {guest.openRequests.length > 0 && (
                              <Badge tone="warning" icon={Bell}>{guest.openRequests.length}</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1"><Calendar size={12} /> {fmtDate(guest.checkInDate)}</span>
                          <span className="flex items-center gap-1"><ChevronRight size={12} /> {fmtDate(guest.checkOutDate)}</span>
                          {guest.transfers.length > 0 && <span className="flex items-center gap-1"><Plane size={12} /> {guest.transfers.length} transfer{guest.transfers.length > 1 ? 's' : ''}</span>}
                          {guest.spaAppointments.length > 0 && <span className="flex items-center gap-1"><Sparkles size={12} /> {guest.spaAppointments.length} spa</span>}
                        </div>
                      </div>
                      <ChevronRight size={20} className="text-slate-400 shrink-0" />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Guest details */}
          <div className="lg:col-span-1">
            {selectedGuest ? (
              <SectionCard
                title="Guest Details"
                icon={UserCheck}
                pad="none"
                className="sticky top-6"
                actions={
                  <button onClick={() => setSelectedId(null)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors">
                    <X size={18} className="text-slate-400" />
                  </button>
                }
              >
                <div className="p-4 space-y-4">
                  <div className={`p-3 rounded-lg flex items-center gap-2 ${catMeta(selectedGuest.category).chip}`}>
                    {React.createElement(catMeta(selectedGuest.category).icon, { size: 18 })}
                    <span className="font-medium">{selectedGuest.category}</span>
                    <Badge tone={STAY_META[selectedGuest.status].tone} className="ml-auto">
                      {STAY_META[selectedGuest.status].label}
                    </Badge>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{selectedGuest.name}</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      {selectedGuest.roomNumber || 'No active reservation'}
                      {selectedGuest.nationality ? ` · ${selectedGuest.nationality}` : ''}
                    </p>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Check In</span><span className="text-slate-900 dark:text-white">{fmtDate(selectedGuest.checkInDate)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Check Out</span><span className="text-slate-900 dark:text-white">{fmtDate(selectedGuest.checkOutDate)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Loyalty Points</span><span className="text-slate-900 dark:text-white">{selectedGuest.loyaltyPoints.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Total Spend</span><span className="text-slate-900 dark:text-white">{formatAmount(selectedGuest.totalSpend)}</span></div>
                    {selectedGuest.email && <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="text-slate-900 dark:text-white truncate ml-4">{selectedGuest.email}</span></div>}
                    {selectedGuest.phone && <div className="flex justify-between"><span className="text-slate-500">Phone</span><span className="text-slate-900 dark:text-white">{selectedGuest.phone}</span></div>}
                  </div>

                  {selectedGuest.preferences.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">Preferences</h5>
                      <div className="space-y-1">
                        {selectedGuest.preferences.map((pref, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                            <span className="text-slate-700 dark:text-slate-300">{pref}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedGuest.specialRequests.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">Special Requests</h5>
                      <div className="space-y-1">
                        {selectedGuest.specialRequests.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <Bell size={14} className="text-amber-500 shrink-0" />
                            <span className="text-slate-700 dark:text-slate-300">{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live cross-portal activity */}
                  {(selectedGuest.openRequests.length > 0 || selectedGuest.transfers.length > 0 || selectedGuest.spaAppointments.length > 0 || selectedGuest.prepTasks.length > 0) && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-2">Live Activity</h5>
                      <div className="space-y-2">
                        {selectedGuest.openRequests.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300 truncate">
                              <ClipboardList size={13} className="inline mr-1.5 text-slate-400" />
                              {r.type}{r.description ? ` — ${r.description}` : ''}
                            </span>
                            <Badge tone={r.priority === 'High' || r.priority === 'Critical' ? 'warning' : 'neutral'}>{r.status}</Badge>
                          </div>
                        ))}
                        {selectedGuest.transfers.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300 truncate">
                              <Plane size={13} className="inline mr-1.5 text-slate-400" />
                              {t.service || 'Transfer'}{t.flightNumber ? ` · ${t.flightNumber}` : ''} — {fmtDateTime(t.scheduledTime)}
                            </span>
                            <Badge tone="info">{t.status || 'Scheduled'}</Badge>
                          </div>
                        ))}
                        {selectedGuest.spaAppointments.map((s) => (
                          <div key={s.id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300 truncate">
                              <Sparkles size={13} className="inline mr-1.5 text-slate-400" />
                              {s.treatment || 'Spa'} — {fmtDate(s.date)}{s.time ? ` ${s.time}` : ''}
                            </span>
                            <Badge tone="neutral">{s.status}</Badge>
                          </div>
                        ))}
                        {selectedGuest.prepTasks.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                            <span className="text-slate-700 dark:text-slate-300 truncate">
                              <BedDouble size={13} className="inline mr-1.5 text-slate-400" />
                              {t.type} — {t.location}
                            </span>
                            <Badge tone={t.status === 'Completed' ? 'success' : 'warning'}>{t.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Raise a concierge request (writes to guest_requests) */}
                  <div className="pt-3 border-t border-gray-200 dark:border-slate-700 space-y-2">
                    <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">Raise Request (Front Office)</h5>
                    <div className="flex gap-2">
                      <select value={reqType} onChange={(e) => setReqType(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm">
                        {['VIP Service', 'Amenity', 'Housekeeping', 'Dining', 'Transport', 'Other'].map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <input value={reqDesc} onChange={(e) => setReqDesc(e.target.value)} placeholder="Request details…" className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
                    </div>
                    <button className={button.secondary} onClick={raiseRequest} disabled={saving || !reqDesc.trim()}>
                      <Utensils size={14} /> Send to Concierge
                    </button>
                  </div>

                  {/* Ops profile (category / butler / notifications) */}
                  <div className="pt-3 border-t border-gray-200 dark:border-slate-700 space-y-2">
                    <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">Ops Profile</h5>
                    <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as VipCategory)} className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input value={editButler} onChange={(e) => setEditButler(e.target.value)} placeholder="Assigned butler" className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Ops notes (internal)" rows={2} className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm resize-none" />
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input type="checkbox" checked={editNotify} onChange={(e) => setEditNotify(e.target.checked)} className="rounded" />
                      Arrival notifications enabled
                    </label>
                    <button className={button.primary} onClick={saveProfile} disabled={saving}>
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Profile
                    </button>
                  </div>
                </div>
              </SectionCard>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-8 text-center sticky top-6">
                <Star size={48} className="text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600 dark:text-slate-400">Select a VIP guest to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VIPGuestManagement;
