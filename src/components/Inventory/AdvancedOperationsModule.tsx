/**
 * Advanced Operations — critical spares, equipment compatibility,
 * guest/third-party custody, and store opening/closing sessions.
 *
 * Covers spec S49, S51, S52, and S75.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Link as LinkIcon, UserCheck, DoorOpen, Plus, Search,
  Loader2, ServerCrash, MoreVertical, Trash2, Edit3, Check, X,
  Package, ShieldCheck, Thermometer, Clock, Wrench, Building2, User, Monitor,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchCriticalSpares, createCriticalSpare, updateCriticalSpare, deleteCriticalSpare,
  fetchEquipmentCompatibility, createEquipmentCompatibility, deleteEquipmentCompatibility,
  fetchGuestCustody, createGuestCustody, updateGuestCustody, deleteGuestCustody,
  fetchStoreSessions, createStoreSession, updateStoreSession, deleteStoreSession,
  fetchItems, fetchAssets, fetchStores,
  fetchTemperatureLogs, createTemperatureLog, deleteTemperatureLog,
  fetchChemicals, createChemical, updateChemical, deleteChemical,
  type UinvCriticalSpare, type UinvEquipmentCompatibility, type UinvGuestCustody, type UinvStoreSession,
  type UinvItem, type UinvAsset, type UinvStore,
  type UinvTemperatureLog, type UinvChemical,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, OpsCell, IconButton } from './InventoryTable';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const SUB_TABS = [
  { id: 'critical-spares', label: 'Critical Spares', icon: AlertTriangle },
  { id: 'compatibility', label: 'Compatibility', icon: LinkIcon },
  { id: 'guest-custody', label: 'Guest Custody', icon: UserCheck },
  { id: 'store-ops', label: 'Store Open/Close', icon: DoorOpen },
  { id: 'temperature', label: 'Temperature Logs', icon: Thermometer },
  { id: 'chemicals', label: 'Chemicals', icon: ShieldCheck },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];

function toneFor(status?: string | null): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (!status) return 'neutral';
  if (['Completed', 'Released', 'In Stock'].includes(status)) return 'success';
  if (['In Custody', 'Active', 'In Progress', 'Exceptions Noted', 'High', 'Medium'].includes(status)) return 'warning';
  if (['Critical', 'Expired', 'Damaged', 'Lost', 'Disposed'].includes(status)) return 'danger';
  if (['Opening'].includes(status)) return 'info';
  return 'neutral';
}

function critTone(c: string) {
  if (c === 'Critical') return 'danger' as const;
  if (c === 'High') return 'warning' as const;
  if (c === 'Medium') return 'info' as const;
  return 'neutral' as const;
}

function chemTone(ch: UinvChemical): 'success' | 'warning' | 'danger' | 'neutral' {
  const s = ch.hazard_level;
  if (s === 'Very High' || s === 'High') return 'danger';
  if (s === 'Medium') return 'warning';
  return 'success';
}

const AdvancedOperationsModule: React.FC<{ initialTab?: SubTab }> = ({ initialTab = 'critical-spares' }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [activeTab, setActiveTab] = useState<SubTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [criticalSpares, setCriticalSpares] = useState<UinvCriticalSpare[]>([]);
  const [compatibility, setCompatibility] = useState<UinvEquipmentCompatibility[]>([]);
  const [guestCustody, setGuestCustody] = useState<UinvGuestCustody[]>([]);
  const [storeSessions, setStoreSessions] = useState<UinvStoreSession[]>([]);
  const [items, setItems] = useState<UinvItem[]>([]);
  const [assets, setAssets] = useState<UinvAsset[]>([]);
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [tempLogs, setTempLogs] = useState<UinvTemperatureLog[]>([]);
  const [chemicals, setChemicals] = useState<UinvChemical[]>([]);

  // Modals
  const [csOpen, setCsOpen] = useState<UinvCriticalSpare | null>(null);
  const [ecOpen, setEcOpen] = useState(false);
  const [gcOpen, setGcOpen] = useState<UinvGuestCustody | null>(null);
  const [gcRelease, setGcRelease] = useState<UinvGuestCustody | null>(null);
  const [ssOpen, setSsOpen] = useState<UinvStoreSession | null>(null);
  const [ssView, setSsView] = useState<UinvStoreSession | null>(null);
  const [tempOpen, setTempOpen] = useState(false);
  const [chemOpen, setChemOpen] = useState<UinvChemical | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [menu, setMenu] = useState<{ type: string; id: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [csFilter, setCsFilter] = useState('All');
  const [gcFilter, setGcFilter] = useState('All');
  const [ssFilter, setSsFilter] = useState('All');
  const [tempFilter, setTempFilter] = useState('All');
  const [chemFilter, setChemFilter] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = currentPropertyId || undefined;
      const [cs, ec, gc, ss, it, as, st, tl, ch] = await Promise.all([
        fetchCriticalSpares({ propertyId: p }).catch(() => [] as UinvCriticalSpare[]),
        fetchEquipmentCompatibility({ propertyId: p }).catch(() => [] as UinvEquipmentCompatibility[]),
        fetchGuestCustody({ propertyId: p }).catch(() => [] as UinvGuestCustody[]),
        fetchStoreSessions({ propertyId: p }).catch(() => [] as UinvStoreSession[]),
        fetchItems({ propertyId: p }).catch(() => [] as UinvItem[]),
        fetchAssets({ propertyId: p }).catch(() => [] as UinvAsset[]),
        fetchStores({ propertyId: p }).catch(() => [] as UinvStore[]),
        fetchTemperatureLogs().catch(() => [] as UinvTemperatureLog[]),
        fetchChemicals({ propertyId: p }).catch(() => [] as UinvChemical[]),
      ]);
      setCriticalSpares(cs);
      setCompatibility(ec);
      setGuestCustody(gc);
      setStoreSessions(ss);
      setItems(it);
      setAssets(as);
      setStores(st);
      setTempLogs(tl);
      setChemicals(ch);
    } catch (e: any) {
      setError(e?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const matchSearch = (s: string) => s.toLowerCase().includes(search.toLowerCase());

  const filteredCS = useMemo(() => criticalSpares.filter(cs => {
    const matchesFilter = csFilter === 'All' || cs.criticality === csFilter;
    const label = [cs.item?.item_name, cs.item?.item_code, cs.emergency_availability].filter(Boolean).join(' ');
    return matchesFilter && (matchSearch(label) || matchSearch(cs.criticality));
  }), [criticalSpares, csFilter, search]);

  const filteredEC = useMemo(() => compatibility.filter(ec =>
    matchSearch([ec.item?.item_name, ec.asset?.asset_name, ec.asset?.asset_number].filter(Boolean).join(' '))
  ), [compatibility, search]);

  const filteredGC = useMemo(() => guestCustody.filter(gc => {
    const matchesFilter = gcFilter === 'All' || gc.status === gcFilter;
    const label = [gc.custody_number, gc.owner_name, gc.item_description, gc.custodian].filter(Boolean).join(' ');
    return matchesFilter && matchSearch(label);
  }), [guestCustody, gcFilter, search]);

  const filteredSS = useMemo(() => storeSessions.filter(ss => {
    const matchesFilter = ssFilter === 'All' || ss.session_type === ssFilter;
    const label = [ss.store?.store_name, ss.performed_by, ss.exceptions, ss.notes].filter(Boolean).join(' ');
    return matchesFilter && matchSearch(label);
  }), [storeSessions, ssFilter, search]);

  const filteredTemp = useMemo(() => tempLogs.filter(tl => {
    const matchesFilter = tempFilter === 'All' || tl.status === tempFilter;
    const label = [tl.store?.store_name, tl.recorded_by, tl.status].filter(Boolean).join(' ');
    return matchesFilter && matchSearch(label);
  }), [tempLogs, tempFilter, search]);

  const filteredChem = useMemo(() => chemicals.filter(ch => {
    const matchesFilter = chemFilter === 'All' || ch.hazard_level === chemFilter;
    const label = [ch.item?.item_name, ch.classification, ch.storage_requirement, ch.sds_reference].filter(Boolean).join(' ');
    return matchesFilter && matchSearch(label);
  }), [chemicals, chemFilter, search]);

  const csKpi = useMemo(() => ({
    critical: criticalSpares.filter(cs => cs.criticality === 'Critical').length,
    high: criticalSpares.filter(cs => cs.criticality === 'High').length,
    below: criticalSpares.filter(cs => cs.item && Number(cs.item.current_stock ?? 0) < cs.min_stock).length,
    total: criticalSpares.length,
  }), [criticalSpares]);

  const ecKpi = useMemo(() => ({
    total: compatibility.length,
    primary: compatibility.filter(ec => ec.is_primary).length,
    itemCount: new Set(compatibility.map(ec => ec.item_id)).size,
    assetCount: new Set(compatibility.map(ec => ec.asset_id)).size,
  }), [compatibility]);

  const gcKpi = useMemo(() => ({
    in: guestCustody.filter(gc => gc.status === 'In Custody').length,
    released: guestCustody.filter(gc => gc.status === 'Released').length,
    total: guestCustody.reduce((a, b) => a + Number(b.quantity), 0),
    owners: new Set(guestCustody.map(gc => gc.owner_name)).size,
  }), [guestCustody]);

  const ssKpi = useMemo(() => ({
    todayOpen: storeSessions.filter(ss => ss.session_type === 'Opening' && ss.session_date === new Date().toISOString().split('T')[0]).length,
    todayClose: storeSessions.filter(ss => ss.session_type === 'Closing' && ss.session_date === new Date().toISOString().split('T')[0]).length,
    exceptions: storeSessions.filter(ss => ss.status === 'Exceptions Noted').length,
    completed: storeSessions.filter(ss => ss.status === 'Completed').length,
  }), [storeSessions]);

  async function handleCS(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const payload: Partial<UinvCriticalSpare> = {
      property_id: currentPropertyId,
      item_id: fd.get('item_id') as string,
      criticality: fd.get('criticality') as any,
      min_stock: Number(fd.get('min_stock')),
      lead_time_days: Number(fd.get('lead_time_days')),
      emergency_availability: (fd.get('emergency_availability') as string) || null,
      compatible_equipment: ((fd.get('compatible_equipment') as string) || '').split(',').map(s => s.trim()).filter(Boolean),
      notes: (fd.get('notes') as string) || null,
    };
    if (!payload.item_id) return addNotification('Item is required', 'warning', 'inventory');
    setSubmitting(true);
    try {
      if (csOpen?.id) {
        const u = await updateCriticalSpare(csOpen.id, payload);
        setCriticalSpares(prev => prev.map(x => x.id === u.id ? u : x));
        addNotification('Critical spare updated', 'success', 'inventory');
      } else {
        const c = await createCriticalSpare(payload);
        setCriticalSpares(prev => [c, ...prev]);
        addNotification('Critical spare created', 'success', 'inventory');
      }
      setCsOpen(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save critical spare', 'warning', 'inventory');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEC(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const payload: Partial<UinvEquipmentCompatibility> = {
      property_id: currentPropertyId,
      item_id: fd.get('item_id') as string,
      asset_id: fd.get('asset_id') as string,
      compatibility_notes: (fd.get('compatibility_notes') as string) || null,
      is_primary: (fd.get('is_primary') as string) === 'on',
    };
    if (!payload.item_id || !payload.asset_id) return addNotification('Item and asset are required', 'warning', 'inventory');
    setSubmitting(true);
    try {
      const c = await createEquipmentCompatibility(payload);
      setCompatibility(prev => [c, ...prev]);
      addNotification('Compatibility mapping created', 'success', 'inventory');
      setEcOpen(false);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save compatibility', 'warning', 'inventory');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGC(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const payload: Partial<UinvGuestCustody> = {
      property_id: currentPropertyId,
      custody_number: (fd.get('custody_number') as string) || `CUST-${Date.now()}`,
      owner_name: fd.get('owner_name') as string,
      owner_type: fd.get('owner_type') as any,
      item_description: fd.get('item_description') as string,
      quantity: Number(fd.get('quantity')),
      received_date: fd.get('received_date') as string,
      location: (fd.get('location') as string) || null,
      custodian: (fd.get('custodian') as string) || null,
      condition: fd.get('condition') as any,
      notes: (fd.get('notes') as string) || null,
    };
    setSubmitting(true);
    try {
      if (gcOpen?.id) {
        const u = await updateGuestCustody(gcOpen.id, payload);
        setGuestCustody(prev => prev.map(x => x.id === u.id ? u : x));
        addNotification('Guest custody updated', 'success', 'inventory');
      } else {
        const c = await createGuestCustody(payload);
        setGuestCustody(prev => [c, ...prev]);
        addNotification('Guest custody recorded', 'success', 'inventory');
      }
      setGcOpen(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save guest custody', 'warning', 'inventory');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGCRelease(e: React.FormEvent) {
    e.preventDefault();
    if (!gcRelease) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    setSubmitting(true);
    try {
      const u = await updateGuestCustody(gcRelease.id, {
        status: 'Released',
        release_authorization: (fd.get('release_authorization') as string) || null,
        release_date: (fd.get('release_date') as string) || new Date().toISOString().split('T')[0],
        released_to: (fd.get('released_to') as string) || null,
      });
      setGuestCustody(prev => prev.map(x => x.id === u.id ? u : x));
      addNotification('Item released to owner', 'success', 'inventory');
      setGcRelease(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to release custody', 'warning', 'inventory');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSS(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const checklist: any[] = [];
    (['temperature_checked','security_checked','cold_room_checked','pending_transactions_reviewed','stock_exceptions_reviewed','high_value_secured','receipts_completed','issues_completed','transfers_reviewed','returns_reviewed','expiry_reviewed'] as const).forEach(k => {
      checklist.push({ item: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), checked: fd.get(k) === 'on' });
    });
    const payload: Partial<UinvStoreSession> = {
      property_id: currentPropertyId,
      store_id: fd.get('store_id') as string,
      session_type: fd.get('session_type') as any,
      session_date: fd.get('session_date') as string,
      performed_by: fd.get('performed_by') as string,
      temperature_checked: fd.get('temperature_checked') === 'on',
      temperature_reading: fd.get('temperature_reading') ? Number(fd.get('temperature_reading')) : null,
      security_checked: fd.get('security_checked') === 'on',
      cold_room_checked: fd.get('cold_room_checked') === 'on',
      pending_transactions_reviewed: fd.get('pending_transactions_reviewed') === 'on',
      stock_exceptions_reviewed: fd.get('stock_exceptions_reviewed') === 'on',
      high_value_secured: fd.get('high_value_secured') === 'on',
      receipts_completed: fd.get('receipts_completed') === 'on',
      issues_completed: fd.get('issues_completed') === 'on',
      transfers_reviewed: fd.get('transfers_reviewed') === 'on',
      returns_reviewed: fd.get('returns_reviewed') === 'on',
      expiry_reviewed: fd.get('expiry_reviewed') === 'on',
      checklist,
      exceptions: (fd.get('exceptions') as string) || null,
      status: (fd.get('exceptions') as string) ? 'Exceptions Noted' : 'Completed',
      notes: (fd.get('notes') as string) || null,
    };
    if (!payload.store_id || !payload.session_date || !payload.performed_by) {
      return addNotification('Store, date, and performed-by are required', 'warning', 'inventory');
    }
    setSubmitting(true);
    try {
      if (ssOpen?.id) {
        const u = await updateStoreSession(ssOpen.id, payload);
        setStoreSessions(prev => prev.map(x => x.id === u.id ? u : x));
        addNotification('Store session updated', 'success', 'inventory');
      } else {
        const c = await createStoreSession(payload);
        setStoreSessions(prev => [c, ...prev]);
        addNotification('Store session recorded', 'success', 'inventory');
      }
      setSsOpen(null);
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save store session', 'warning', 'inventory');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteOne(type: string, id: string) {
    try {
      if (type === 'cs') { await deleteCriticalSpare(id); setCriticalSpares(prev => prev.filter(x => x.id !== id)); }
      if (type === 'ec') { await deleteEquipmentCompatibility(id); setCompatibility(prev => prev.filter(x => x.id !== id)); }
      if (type === 'gc') { await deleteGuestCustody(id); setGuestCustody(prev => prev.filter(x => x.id !== id)); }
      if (type === 'ss') { await deleteStoreSession(id); setStoreSessions(prev => prev.filter(x => x.id !== id)); }
      addNotification('Record deleted', 'success', 'inventory');
    } catch (e: any) {
      addNotification(e?.message || 'Delete failed', 'warning', 'inventory');
    }
    setMenu(null);
  }

  const renderMenu = (type: string, id: string) => {
    if (menu?.type !== type || menu?.id !== id) return null;
    return (
      <div className="absolute right-0 top-full mt-1 w-36 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-200 dark:border-slate-700 py-1 z-20">
        {type === 'cs' && (
          <button onClick={() => { setCsOpen(criticalSpares.find(x => x.id === id) || { id: '' } as any); setMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2">
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        {type === 'gc' && (
          <>
            <button onClick={() => { setGcOpen(guestCustody.find(x => x.id === id) || null); setMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </button>
            <button onClick={() => { setGcRelease(guestCustody.find(x => x.id === id) || null); setMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2">
              <Check className="w-3.5 h-3.5" /> Release
            </button>
          </>
        )}
        {type === 'ss' && (
          <button onClick={() => { setSsOpen(storeSessions.find(x => x.id === id) || null); setMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2">
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        <button onClick={() => deleteOne(type, id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2">
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>
    );
  };

  const today = new Date().toISOString().split('T')[0];

  // Sub-tab bar — matches the portal-wide pattern (SectionCard + standard button styles)
  const subTabBar = (
    <SectionCard pad="md">
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 overflow-x-auto">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={[
                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                active
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300',
              ].join(' ')}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Advanced Operations"
        subtitle="Critical spares, equipment compatibility, guest custody, and store open/close sessions."
        icon={Wrench}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
          </button>
        }
      />

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* ── Critical Spares ── */}
          {activeTab === 'critical-spares' && (
            <>
              <div className={layout.kpiGrid}>
                <StatCard title="Critical" value={csKpi.critical} icon={AlertTriangle} tone="danger" />
                <StatCard title="High" value={csKpi.high} icon={AlertTriangle} tone="warning" />
                <StatCard title="Below Min Stock" value={csKpi.below} icon={Package} tone="danger" />
                <StatCard title="Total Classified" value={csKpi.total} icon={Package} tone="neutral" />
              </div>
              {subTabBar}
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-1">
                  {['All','Critical','High','Medium','Normal'].map(f => (
                    <button key={f} onClick={() => setCsFilter(f)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${csFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>{f}</button>
                  ))}
                </div>
                <button onClick={() => setCsOpen({} as any)} className={button.primary}><Plus className="w-4 h-4" /> New</button>
              </div>
              <InventoryTable
                columns={['Item', 'Criticality', 'Min Stock', 'Lead Time', 'Emergency', 'Actions']}
                loading={loading}
                error={error}
                onRetry={load}
                emptyMessage="No critical spare records."
              >
                {filteredCS.map(cs => (
                  <tr key={cs.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <IdentityCell icon={<Package size={16} />} soft={statusTone.neutral.soft} text={statusTone.neutral.text} name={cs.item?.item_name || cs.item_id} code={cs.item?.item_code || ''} />
                    <td><Badge tone={critTone(cs.criticality)}>{cs.criticality}</Badge></td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{cs.min_stock}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{cs.lead_time_days}d</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300 truncate max-w-[160px]">{cs.emergency_availability || '—'}</td>
                    <td className="text-right">
                      <div className="relative inline-block">
                        <IconButton onClick={() => setMenu({ type: 'cs', id: cs.id })} title="Actions"><MoreVertical className="w-4 h-4" /></IconButton>
                        {renderMenu('cs', cs.id)}
                      </div>
                    </td>
                  </tr>
                ))}
              </InventoryTable>
            </>
          )}

          {/* ── Equipment Compatibility ── */}
          {activeTab === 'compatibility' && (
            <>
              <div className={layout.kpiGrid}>
                <StatCard title="Total Mappings" value={ecKpi.total} icon={LinkIcon} tone="info" />
                <StatCard title="Primary Mappings" value={ecKpi.primary} icon={LinkIcon} tone="success" />
                <StatCard title="Items Mapped" value={ecKpi.itemCount} icon={Package} tone="neutral" />
                <StatCard title="Assets Mapped" value={ecKpi.assetCount} icon={Monitor} tone="neutral" />
              </div>
              {subTabBar}
              <div className="flex items-center justify-between">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mappings…" className={inputClass + ' pl-9'} />
                </div>
                <button onClick={() => setEcOpen(true)} className={button.primary}><Plus className="w-4 h-4" /> Map Item</button>
              </div>
              <InventoryTable columns={['Item', 'Asset', 'Notes', 'Primary', 'Actions']} loading={loading} error={error} onRetry={load} emptyMessage="No compatibility mappings.">
                {filteredEC.map(ec => (
                  <tr key={ec.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <IdentityCell icon={<Package size={16} />} soft={statusTone.neutral.soft} text={statusTone.neutral.text} name={ec.item?.item_name || ec.item_id} code={ec.item?.item_code || ''} />
                    <IdentityCell icon={<Monitor size={16} />} soft={statusTone.info.soft} text={statusTone.info.text} name={ec.asset?.asset_name || ec.asset_id} code={ec.asset?.asset_number || ''} />
                    <td className="text-sm text-gray-700 dark:text-slate-300 truncate max-w-[180px]">{ec.compatibility_notes || '—'}</td>
                    <td>{ec.is_primary ? <Badge tone="success">Primary</Badge> : <span className="text-sm text-gray-400">—</span>}</td>
                    <td className="text-right">
                      <div className="relative inline-block">
                        <IconButton onClick={() => setMenu({ type: 'ec', id: ec.id })} title="Actions"><MoreVertical className="w-4 h-4" /></IconButton>
                        {renderMenu('ec', ec.id)}
                      </div>
                    </td>
                  </tr>
                ))}
              </InventoryTable>
            </>
          )}

          {/* ── Guest Custody ── */}
          {activeTab === 'guest-custody' && (
            <>
              <div className={layout.kpiGrid}>
                <StatCard title="In Custody" value={gcKpi.in} icon={UserCheck} tone="warning" />
                <StatCard title="Released" value={gcKpi.released} icon={Check} tone="success" />
                <StatCard title="Total Items" value={gcKpi.total} icon={Package} tone="info" />
                <StatCard title="Owners" value={gcKpi.owners} icon={User} tone="neutral" />
              </div>
              {subTabBar}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  {['All','In Custody','Released','Transferred','Disposed'].map(f => (
                    <button key={f} onClick={() => setGcFilter(f)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${gcFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>{f}</button>
                  ))}
                </div>
                <button onClick={() => setGcOpen({} as any)} className={button.primary}><Plus className="w-4 h-4" /> New</button>
              </div>
              <InventoryTable columns={['Custody #', 'Owner', 'Type', 'Description', 'Qty', 'Received', 'Location', 'Condition', 'Status', 'Actions']} loading={loading} error={error} onRetry={load} emptyMessage="No guest custody records.">
                {filteredGC.map(gc => (
                  <tr key={gc.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="text-sm font-mono text-gray-700 dark:text-slate-300">{gc.custody_number}</td>
                    <IdentityCell icon={<UserCheck size={16} />} soft={statusTone.warning.soft} text={statusTone.warning.text} name={gc.owner_name} code={gc.owner_type} />
                    <td className="text-sm text-gray-700 dark:text-slate-300">{gc.owner_type}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300 truncate max-w-[140px]">{gc.item_description}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{gc.quantity}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{gc.received_date}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300 truncate max-w-[120px]">{gc.location || '—'}</td>
                    <td><Badge tone={toneFor(gc.condition)}>{gc.condition}</Badge></td>
                    <td><Badge tone={toneFor(gc.status)}>{gc.status}</Badge></td>
                    <td className="text-right">
                      <div className="relative inline-block">
                        <IconButton onClick={() => setMenu({ type: 'gc', id: gc.id })} title="Actions"><MoreVertical className="w-4 h-4" /></IconButton>
                        {renderMenu('gc', gc.id)}
                      </div>
                    </td>
                  </tr>
                ))}
              </InventoryTable>
            </>
          )}

          {/* ── Store Sessions ── */}
          {activeTab === 'store-ops' && (
            <>
              <div className={layout.kpiGrid}>
                <StatCard title="Today's Openings" value={ssKpi.todayOpen} icon={DoorOpen} tone="info" />
                <StatCard title="Today's Closings" value={ssKpi.todayClose} icon={ShieldCheck} tone="success" />
                <StatCard title="Exceptions Noted" value={ssKpi.exceptions} icon={AlertTriangle} tone="danger" />
                <StatCard title="Completed" value={ssKpi.completed} icon={Check} tone="success" />
              </div>
              {subTabBar}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  {['All','Opening','Closing'].map(f => (
                    <button key={f} onClick={() => setSsFilter(f)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${ssFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>{f}</button>
                  ))}
                </div>
                <button onClick={() => setSsOpen({} as any)} className={button.primary}><Plus className="w-4 h-4" /> New Session</button>
              </div>
              <InventoryTable columns={['Store', 'Type', 'Date', 'Performed By', 'Temp', 'Security', 'Status', 'Actions']} loading={loading} error={error} onRetry={load} emptyMessage="No store sessions recorded.">
                {filteredSS.map(ss => (
                  <tr key={ss.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <IdentityCell icon={<Building2 size={16} />} soft={statusTone.info.soft} text={statusTone.info.text} name={ss.store?.store_name || ss.store_id} code={ss.store?.store_code || ''} />
                    <td><Badge tone={ss.session_type === 'Opening' ? 'info' : 'success'}>{ss.session_type}</Badge></td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{ss.session_date}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{ss.performed_by}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">
                      {ss.temperature_checked ? `${ss.temperature_reading}°C` : <X className="w-4 h-4 text-gray-400" />}
                    </td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{ss.security_checked ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-gray-400" />}</td>
                    <td><Badge tone={toneFor(ss.status)}>{ss.status}</Badge></td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton onClick={() => setSsView(ss)} title="View"><Search className="w-4 h-4" /></IconButton>
                        <div className="relative inline-block">
                          <IconButton onClick={() => setMenu({ type: 'ss', id: ss.id })} title="Actions"><MoreVertical className="w-4 h-4" /></IconButton>
                          {renderMenu('ss', ss.id)}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </InventoryTable>
            </>
          )}

          {activeTab === 'temperature' && (
            <>
              {subTabBar}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  {['All','OK','Exception','Critical'].map(f => (
                    <button key={f} onClick={() => setTempFilter(f)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${tempFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>{f}</button>
                  ))}
                </div>
                <button onClick={() => setTempOpen(true)} className={button.primary}><Plus className="w-4 h-4" /> New Reading</button>
              </div>
              <InventoryTable columns={['Store', 'Reading Time', 'Temp', 'Range', 'Status', 'Recorded By', 'Actions']} loading={loading} error={error} onRetry={load} emptyMessage="No temperature logs recorded.">
                {filteredTemp.map(tl => (
                  <tr key={tl.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <IdentityCell icon={<Building2 size={16} />} soft={statusTone.info.soft} text={statusTone.info.text} name={tl.store?.store_name || tl.store_id || '—'} code={tl.store?.store_code || ''} />
                    <td className="text-sm text-gray-700 dark:text-slate-300">{tl.reading_time ? new Date(tl.reading_time).toLocaleString() : '—'}</td>
                    <td className="text-sm font-bold text-gray-900 dark:text-white">{tl.actual_temp != null ? `${tl.actual_temp}°${tl.unit || 'C'}` : '—'}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{tl.required_min != null && tl.required_max != null ? `${tl.required_min}–${tl.required_max}` : '—'}</td>
                    <td><Badge tone={tl.status === 'Critical' ? 'danger' : tl.status === 'Exception' ? 'warning' : 'success'}>{tl.status || 'OK'}</Badge></td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{tl.recorded_by || '—'}</td>
                    <td className="text-right">
                      <IconButton onClick={() => { if (confirm('Delete this temperature log?')) { deleteTemperatureLog(tl.id).then(() => { addNotification('Temperature log deleted', 'success', 'Inventory'); load(); }).catch(() => {}); } }} title="Delete"><Trash2 className="w-4 h-4" /></IconButton>
                    </td>
                  </tr>
                ))}
              </InventoryTable>
            </>
          )}

          {activeTab === 'chemicals' && (
            <>
              {subTabBar}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  {['All','Low','Medium','High','Very High'].map(f => (
                    <button key={f} onClick={() => setChemFilter(f)} className={`px-3 py-1.5 text-xs font-bold rounded-lg ${chemFilter === f ? 'bg-[var(--color-accent-operations)] text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>{f}</button>
                  ))}
                </div>
                <button onClick={() => setChemOpen({} as any)} className={button.primary}><Plus className="w-4 h-4" /> New Chemical</button>
              </div>
              <InventoryTable columns={['Item', 'Classification', 'Hazard Level', 'Storage', 'SDS Ref', 'Actions']} loading={loading} error={error} onRetry={load} emptyMessage="No chemicals registered.">
                {filteredChem.map(ch => (
                  <tr key={ch.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <IdentityCell icon={<ShieldCheck size={16} />} soft={statusTone.info.soft} text={statusTone.info.text} name={ch.item?.item_name || ch.item_id || '—'} code={ch.classification || ''} />
                    <td className="text-sm text-gray-700 dark:text-slate-300">{ch.classification || '—'}</td>
                    <td><Badge tone={chemTone(ch)}>{ch.hazard_level || 'Medium'}</Badge></td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{ch.storage_requirement || '—'}</td>
                    <td className="text-sm text-gray-700 dark:text-slate-300">{ch.sds_reference || '—'}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton onClick={() => setChemOpen(ch)} title="Edit"><Edit3 className="w-4 h-4" /></IconButton>
                        <IconButton onClick={() => { if (confirm('Delete this chemical?')) { deleteChemical(ch.id).then(() => { addNotification('Chemical deleted', 'success', 'Inventory'); load(); }).catch(() => {}); } }} title="Delete"><Trash2 className="w-4 h-4" /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </InventoryTable>
            </>
          )}
        </>
      )}

      {/* Critical Spare Modal */}
      <ModalSystem isOpen={!!csOpen} onClose={() => setCsOpen(null)} title={csOpen?.id ? 'Edit Critical Spare' : 'New Critical Spare'} confirmLabel={csOpen?.id ? 'Update' : 'Save'} onConfirm={() => {}} size="md" loading={submitting}>
        <form id="cs-form" onSubmit={handleCS} className="space-y-4">
          <Field label="Item"><select name="item_id" defaultValue={csOpen?.item_id || ''} className={inputClass} required><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.item_name} ({i.item_code})</option>)}</select></Field>
          <Field label="Criticality"><select name="criticality" defaultValue={csOpen?.criticality || 'Normal'} className={inputClass} required>{['Critical','High','Medium','Normal'].map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Min Stock"><input name="min_stock" type="number" step="0.001" defaultValue={csOpen?.min_stock || 0} className={inputClass} required /></Field>
            <Field label="Lead Time (days)"><input name="lead_time_days" type="number" defaultValue={csOpen?.lead_time_days || 0} className={inputClass} required /></Field>
          </div>
          <Field label="Emergency Availability"><input name="emergency_availability" defaultValue={csOpen?.emergency_availability || ''} className={inputClass} placeholder="e.g. Local supplier 24h" /></Field>
          <Field label="Compatible Equipment"><input name="compatible_equipment" defaultValue={csOpen?.compatible_equipment?.join(', ') || ''} className={inputClass} placeholder="Generator 01, Generator 02" /></Field>
          <Field label="Notes"><textarea name="notes" defaultValue={csOpen?.notes || ''} className={inputClass + ' min-h-[80px]'} /></Field>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>

      {/* Compatibility Modal */}
      <ModalSystem isOpen={ecOpen} onClose={() => setEcOpen(false)} title="Map Spare Part to Equipment" confirmLabel="Save" onConfirm={() => {}} size="md" loading={submitting}>
        <form id="ec-form" onSubmit={handleEC} className="space-y-4">
          <Field label="Spare Part (Item)"><select name="item_id" className={inputClass} required><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.item_name} ({i.item_code})</option>)}</select></Field>
          <Field label="Compatible Equipment (Asset)"><select name="asset_id" className={inputClass} required><option value="">Select asset…</option>{assets.map(a => <option key={a.id} value={a.id}>{a.asset_name} ({a.asset_number})</option>)}</select></Field>
          <Field label="Compatibility Notes"><textarea name="compatibility_notes" className={inputClass + ' min-h-[80px]'} /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300"><input name="is_primary" type="checkbox" className="rounded" /> Primary spare part for this asset</label>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>

      {/* Guest Custody Modal */}
      <ModalSystem isOpen={!!gcOpen} onClose={() => setGcOpen(null)} title={gcOpen?.id ? 'Edit Custody' : 'New Guest Custody'} confirmLabel={gcOpen?.id ? 'Update' : 'Save'} onConfirm={() => {}} size="md" loading={submitting}>
        <form id="gc-form" onSubmit={handleGC} className="space-y-4">
          <Field label="Custody Number"><input name="custody_number" defaultValue={gcOpen?.custody_number || `CUST-${Date.now()}`} className={inputClass} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Owner Name"><input name="owner_name" defaultValue={gcOpen?.owner_name || ''} className={inputClass} required /></Field>
            <Field label="Owner Type"><select name="owner_type" defaultValue={gcOpen?.owner_type || 'Guest'} className={inputClass} required>{['Guest','Third Party','Supplier','Vendor','Other'].map(o => <option key={o} value={o}>{o}</option>)}</select></Field>
          </div>
          <Field label="Item Description"><input name="item_description" defaultValue={gcOpen?.item_description || ''} className={inputClass} required /></Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Quantity"><input name="quantity" type="number" defaultValue={gcOpen?.quantity || 1} className={inputClass} required /></Field>
            <Field label="Received Date"><input name="received_date" type="date" defaultValue={gcOpen?.received_date || today} className={inputClass} required /></Field>
            <Field label="Condition"><select name="condition" defaultValue={gcOpen?.condition || 'Good'} className={inputClass}>{['New','Excellent','Good','Fair','Poor','Damaged','Unusable'].map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location"><input name="location" defaultValue={gcOpen?.location || ''} className={inputClass} /></Field>
            <Field label="Custodian"><input name="custodian" defaultValue={gcOpen?.custodian || ''} className={inputClass} /></Field>
          </div>
          <Field label="Notes"><textarea name="notes" defaultValue={gcOpen?.notes || ''} className={inputClass + ' min-h-[80px]'} /></Field>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>

      {/* Release Modal */}
      <ModalSystem isOpen={!!gcRelease} onClose={() => setGcRelease(null)} title="Release to Owner" confirmLabel="Release" onConfirm={() => {}} size="sm" loading={submitting}>
        <form id="gc-release" onSubmit={handleGCRelease} className="space-y-4">
          <Field label="Release Authorization"><input name="release_authorization" className={inputClass} placeholder="Manager sign-off / ticket" required /></Field>
          <Field label="Release Date"><input name="release_date" type="date" defaultValue={today} className={inputClass} required /></Field>
          <Field label="Released To"><input name="released_to" className={inputClass} placeholder="Owner name" required /></Field>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>

      {/* Store Session Modal */}
      <ModalSystem isOpen={!!ssOpen} onClose={() => setSsOpen(null)} title={ssOpen?.id ? 'Edit Store Session' : 'New Store Session'} confirmLabel={ssOpen?.id ? 'Update' : 'Save'} onConfirm={() => {}} size="lg" loading={submitting}>
        <form id="ss-form" onSubmit={handleSS} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Store"><select name="store_id" defaultValue={ssOpen?.store_id || ''} className={inputClass} required><option value="">Select store…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>)}</select></Field>
            <Field label="Session Type"><select name="session_type" defaultValue={ssOpen?.session_type || 'Opening'} className={inputClass} required>{['Opening','Closing'].map(o => <option key={o} value={o}>{o}</option>)}</select></Field>
            <Field label="Session Date"><input name="session_date" type="date" defaultValue={ssOpen?.session_date || today} className={inputClass} required /></Field>
          </div>
          <Field label="Performed By"><input name="performed_by" defaultValue={ssOpen?.performed_by || ''} className={inputClass} required /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Temperature Checked"><div className="flex items-center gap-2"><input name="temperature_checked" type="checkbox" defaultChecked={ssOpen?.temperature_checked} className="rounded" /></div></Field>
            <Field label="Temperature Reading (°C)"><input name="temperature_reading" type="number" step="0.1" defaultValue={ssOpen?.temperature_reading || ''} className={inputClass} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(['security_checked','cold_room_checked','pending_transactions_reviewed','stock_exceptions_reviewed','high_value_secured','receipts_completed','issues_completed','transfers_reviewed','returns_reviewed','expiry_reviewed'] as const).map(k => (
              <label key={k} className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300 bg-gray-50 dark:bg-slate-800 p-2 rounded-lg">
                <input name={k} type="checkbox" defaultChecked={ssOpen ? (ssOpen as any)[k] : false} className="rounded" />
                {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </label>
            ))}
          </div>
          <Field label="Exceptions"><textarea name="exceptions" defaultValue={ssOpen?.exceptions || ''} className={inputClass + ' min-h-[60px]'} placeholder="Describe any exceptions or issues…" /></Field>
          <Field label="Notes"><textarea name="notes" defaultValue={ssOpen?.notes || ''} className={inputClass + ' min-h-[60px]'} /></Field>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>

      {/* Store Session View Modal */}
      <ModalSystem isOpen={!!ssView} onClose={() => setSsView(null)} title="Store Session Details" confirmLabel="Close" onConfirm={() => setSsView(null)} size="md">
        {ssView && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs font-bold text-gray-500 uppercase">Store</p><p className="text-gray-900 dark:text-white">{ssView.store?.store_name || ssView.store_id}</p></div>
              <div><p className="text-xs font-bold text-gray-500 uppercase">Type</p><p className="text-gray-900 dark:text-white">{ssView.session_type}</p></div>
              <div><p className="text-xs font-bold text-gray-500 uppercase">Date</p><p className="text-gray-900 dark:text-white">{ssView.session_date}</p></div>
              <div><p className="text-xs font-bold text-gray-500 uppercase">Performed By</p><p className="text-gray-900 dark:text-white">{ssView.performed_by}</p></div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(['temperature_checked','security_checked','cold_room_checked','pending_transactions_reviewed','stock_exceptions_reviewed','high_value_secured','receipts_completed','issues_completed','transfers_reviewed','returns_reviewed','expiry_reviewed'] as const).map(k => (
                <div key={k} className="flex items-center gap-1.5 p-2 rounded-lg bg-gray-50 dark:bg-slate-800">
                  {(ssView as any)[k] ? <Check className="w-3.5 h-3.5 text-green-500" /> : <X className="w-3.5 h-3.5 text-gray-400" />}
                  <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-700 dark:text-slate-300"><span className="font-bold">Temperature:</span> {ssView.temperature_checked ? `${ssView.temperature_reading}°C` : 'Not checked'}</p>
            {ssView.exceptions && <p className="text-sm text-red-600 dark:text-red-400"><span className="font-bold">Exceptions:</span> {ssView.exceptions}</p>}
            {ssView.notes && <p className="text-sm text-gray-700 dark:text-slate-300"><span className="font-bold">Notes:</span> {ssView.notes}</p>}
          </div>
        )}
      </ModalSystem>

      {/* Temperature Log Modal */}
      <ModalSystem isOpen={tempOpen} onClose={() => setTempOpen(false)} title="New Temperature Reading" confirmLabel="Save" onConfirm={() => {}} size="md" loading={submitting}>
        <form id="temp-form" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setSubmitting(true);
          try {
            const actualTemp = fd.get('actual_temp') ? Number(fd.get('actual_temp')) : 0;
            const reqMin = fd.get('required_min') ? Number(fd.get('required_min')) : null;
            const reqMax = fd.get('required_max') ? Number(fd.get('required_max')) : null;
            let status: 'OK' | 'Exception' | 'Critical' = 'OK';
            if (reqMin != null && actualTemp < reqMin) status = 'Exception';
            if (reqMax != null && actualTemp > reqMax) status = 'Exception';
            if (reqMin != null && reqMax != null && (actualTemp < reqMin - 2 || actualTemp > reqMax + 2)) status = 'Critical';
            await createTemperatureLog({
              store_id: fd.get('store_id') as string,
              actual_temp: actualTemp,
              unit: 'C',
              required_min: reqMin,
              required_max: reqMax,
              reading_time: new Date().toISOString(),
              status,
              recorded_by: fd.get('recorded_by') as string || '',
              corrective_action: fd.get('corrective_action') as string || null,
              notes: fd.get('notes') as string || null,
            } as any);
            addNotification('Temperature log recorded', 'success', 'Inventory');
            setTempOpen(false);
            load();
          } catch (err: any) {
            addNotification(err?.message || 'Failed to record temperature', 'warning', 'Inventory');
          } finally { setSubmitting(false); }
        }} className="space-y-4">
          <Field label="Store"><select name="store_id" className={inputClass} required><option value="">Select store…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>)}</select></Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Actual Temp (°C)"><input name="actual_temp" type="number" step="0.1" className={inputClass} required /></Field>
            <Field label="Min Range"><input name="required_min" type="number" step="0.1" className={inputClass} placeholder="e.g. 2" /></Field>
            <Field label="Max Range"><input name="required_max" type="number" step="0.1" className={inputClass} placeholder="e.g. 8" /></Field>
          </div>
          <Field label="Recorded By"><input name="recorded_by" className={inputClass} /></Field>
          <Field label="Corrective Action"><input name="corrective_action" className={inputClass} placeholder="Action taken if out of range" /></Field>
          <Field label="Notes"><textarea name="notes" className={inputClass + ' min-h-[60px]'} /></Field>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>

      {/* Chemical Modal */}
      <ModalSystem isOpen={!!chemOpen} onClose={() => setChemOpen(null)} title={chemOpen?.id ? 'Edit Chemical' : 'New Chemical'} confirmLabel={chemOpen?.id ? 'Update' : 'Save'} onConfirm={() => {}} size="md" loading={submitting}>
        <form id="chem-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!chemOpen) return;
          const fd = new FormData(e.currentTarget);
          setSubmitting(true);
          try {
            const handlersStr = (fd.get('authorized_handlers') as string || '').trim();
            const payload: Partial<UinvChemical> = {
              item_id: fd.get('item_id') as string || undefined,
              classification: fd.get('classification') as string || 'General',
              storage_requirement: fd.get('storage_requirement') as string || null,
              sds_reference: fd.get('sds_reference') as string || null,
              hazard_level: fd.get('hazard_level') as UinvChemical['hazard_level'] || 'Medium',
              authorized_handlers: handlersStr ? handlersStr.split(',').map(s => s.trim()).filter(Boolean) : null,
              notes: fd.get('notes') as string || null,
            } as any;
            if (chemOpen.id) {
              await updateChemical(chemOpen.id, payload);
              addNotification('Chemical updated', 'success', 'Inventory');
            } else {
              await createChemical({ ...payload, property_id: currentPropertyId } as any);
              addNotification('Chemical created', 'success', 'Inventory');
            }
            setChemOpen(null);
            load();
          } catch (err: any) {
            addNotification(err?.message || 'Failed to save chemical', 'warning', 'Inventory');
          } finally { setSubmitting(false); }
        }} className="space-y-4">
          <Field label="Item"><select name="item_id" defaultValue={chemOpen?.item_id || ''} className={inputClass} required><option value="">Select item…</option>{items.map(i => <option key={i.id} value={i.id}>{i.item_name} ({i.item_code})</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Classification"><input name="classification" defaultValue={chemOpen?.classification || ''} className={inputClass} placeholder="e.g. Cleaning Agent" required /></Field>
            <Field label="Hazard Level"><select name="hazard_level" defaultValue={chemOpen?.hazard_level || 'Medium'} className={inputClass}>{['Low','Medium','High','Very High'].map(h => <option key={h} value={h}>{h}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Storage Requirement"><input name="storage_requirement" defaultValue={chemOpen?.storage_requirement || ''} className={inputClass} placeholder="e.g. Cool, dry, ventilated" /></Field>
            <Field label="SDS Reference"><input name="sds_reference" defaultValue={chemOpen?.sds_reference || ''} className={inputClass} placeholder="Safety Data Sheet ref" /></Field>
          </div>
          <Field label="Authorized Handlers (comma-separated)"><input name="authorized_handlers" defaultValue={chemOpen?.authorized_handlers?.join(', ') || ''} className={inputClass} placeholder="John Doe, Jane Smith" /></Field>
          <Field label="Notes"><textarea name="notes" defaultValue={chemOpen?.notes || ''} className={inputClass + ' min-h-[60px]'} /></Field>
          <button type="submit" className="hidden" />
        </form>
      </ModalSystem>
    </div>
  );
};

export default AdvancedOperationsModule;
