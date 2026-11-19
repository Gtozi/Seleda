/**
 * Unified Inventory Dashboard — /erp/inventory/dashboard
 * DB-integrated via /api/uinv-portal/dashboard.
 * Role-specific KPI views per spec §69 + low-stock / expiring / expired lists.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package, DollarSign, AlertTriangle, TrendingDown, Clock, Truck,
  ClipboardList, ArrowLeftRight, Scale, Trash2, Boxes, Loader2, ServerCrash,
  XCircle, CalendarClock, Building2, Monitor, Search, Wrench, Shirt, BedDouble,
  ShieldCheck, BarChart3, User, Store, Layers,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchDashboard, type DashboardData,
  fetchAssets, fetchTools, fetchLinen, fetchUniforms, fetchReservations,
  globalResourceSearch, type UinvSearchResult,
  type UinvAsset, type UinvTool, type UinvLinenItem, type UinvUniformItem, type UinvReservation,
} from '../../services/inventoryService';

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n || 0);

type RoleView = 'executive' | 'inventory-manager' | 'asset-manager' | 'storekeeper';

const ROLE_TABS: { id: RoleView; label: string; icon: any }[] = [
  { id: 'executive', label: 'Executive', icon: BarChart3 },
  { id: 'inventory-manager', label: 'Inventory Manager', icon: Package },
  { id: 'asset-manager', label: 'Asset Manager', icon: Monitor },
  { id: 'storekeeper', label: 'Storekeeper', icon: Store },
];

const segBtn = (active: boolean) =>
  `px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
    active
      ? 'bg-[var(--color-accent-operations)] text-white shadow-sm'
      : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800'
  }`;

function toneForSearch(status: string | null): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (!status) return 'neutral';
  if (['Available', 'In Stock', 'In Service', 'Active', 'Open'].includes(status)) return 'success';
  if (['Pending', 'Assigned', 'Issued', 'Reserved'].includes(status)) return 'warning';
  if (['Damaged', 'Lost', 'Expired', 'Disposed', 'Retired', 'Cancelled'].includes(status)) return 'danger';
  if (['Quarantined', 'Inspected', 'In Transit'].includes(status)) return 'info';
  return 'neutral';
}

const UnifiedInventoryDashboard: React.FC = () => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<RoleView>('executive');
  const [assets, setAssets] = useState<UinvAsset[]>([]);
  const [tools, setTools] = useState<UinvTool[]>([]);
  const [linen, setLinen] = useState<UinvLinenItem[]>([]);
  const [uniforms, setUniforms] = useState<UinvUniformItem[]>([]);
  const [reservations, setReservations] = useState<UinvReservation[]>([]);

  // ── Global search (integrated from GlobalSearchModule) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UinvSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSelected, setSearchSelected] = useState<UinvSearchResult | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      try {
        const r = await globalResourceSearch(searchQuery, currentPropertyId || undefined);
        setSearchResults(r);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, currentPropertyId]);

  const groupedResults = useMemo(() => {
    const map: Record<string, UinvSearchResult[]> = {};
    searchResults.forEach(r => { (map[r.type] = map[r.type] || []).push(r); });
    return map;
  }, [searchResults]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const propId = currentPropertyId || undefined;
      const [d, a, t, l, u, r] = await Promise.all([
        fetchDashboard(propId),
        fetchAssets({ propertyId: propId }).catch(() => [] as UinvAsset[]),
        fetchTools({ propertyId: propId }).catch(() => [] as UinvTool[]),
        fetchLinen({ propertyId: propId }).catch(() => [] as UinvLinenItem[]),
        fetchUniforms({ propertyId: propId }).catch(() => [] as UinvUniformItem[]),
        fetchReservations({ propertyId: propId, status: 'Active' }).catch(() => [] as UinvReservation[]),
      ]);
      setData(d);
      setAssets(a);
      setTools(t);
      setLinen(l);
      setUniforms(u);
      setReservations(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => (formatAmount ? formatAmount(n) : fmtMoney(n));

  // Derived KPIs for role views
  const assetsByDept = useMemo(() => {
    const map: Record<string, number> = {};
    assets.forEach(a => { if (a.department) map[a.department] = (map[a.department] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [assets]);

  const assetsByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    assets.forEach(a => { map[a.status] = (map[a.status] || 0) + 1; });
    return map;
  }, [assets]);

  const toolsIssued = tools.filter(t => t.status === 'Issued').length;
  const toolsAvailable = tools.filter(t => t.status === 'Available').length;
  const linenBelowPar = linen.filter(l => Number(l.par_level) > 0 && Number(l.clean_quantity) < Number(l.par_level)).length;
  const uniformsAssigned = uniforms.filter(u => u.status === 'Assigned').length;

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Inventory & Stores"
        subtitle="System of record for physical stock across the property."
        icon={Boxes}
        actions={
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* ── Global Resource Search bar ── */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            placeholder="Search items, assets, serials, batches, stores, tools…"
            className="w-full pl-12 pr-10 py-3 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchOpen(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
        </div>
        {searchOpen && searchQuery.trim().length >= 2 && (
          <div className="absolute z-20 mt-1 w-full max-h-96 overflow-y-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg">
            {searchLoading && (
              <div className="p-4 text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Searching…
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No results for "{searchQuery}"</div>
            )}
            {!searchLoading && searchResults.length > 0 && (
              <>
                <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100 dark:border-slate-700">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                </div>
                {['Item', 'Asset', 'Serial', 'Batch', 'Store', 'Tool'].map(type => {
                  const items = groupedResults[type];
                  if (!items || items.length === 0) return null;
                  const TypeIcon = ({ Item: Package, Asset: Boxes, Serial: Search, Batch: Search, Store: Building2, Tool: Wrench } as any)[type] || Package;
                  return (
                    <div key={type}>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 bg-gray-50 dark:bg-slate-900/40 flex items-center gap-1.5">
                        <TypeIcon className="w-3 h-3" /> {type}s ({items.length})
                      </div>
                      {items.slice(0, 5).map((r, i) => (
                        <button
                          key={i}
                          onClick={() => setSearchSelected(r)}
                          className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors border-b border-gray-50 dark:border-slate-700/50 last:border-0"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.label}</p>
                            <p className="text-xs text-gray-500 truncate">{r.subtitle}{r.location && ` · ${r.location}`}</p>
                          </div>
                          {r.status && <Badge tone={toneForSearch(r.status)}>{r.status}</Badge>}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Role selector — spec §69 */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-slate-800 rounded-xl w-fit">
        {ROLE_TABS.map(rt => (
          <button key={rt.id} onClick={() => setRole(rt.id)} className={segBtn(role === rt.id)}>
            <rt.icon className="w-3.5 h-3.5" />
            {rt.label}
          </button>
        ))}
      </div>

      {/* ── Executive View (spec §69 Executive) ── */}
      {role === 'executive' && (
        <>
          <div className={layout.kpiGrid}>
            <StatCard title="Inventory Value" value={money(data?.totalValue || 0)} icon={DollarSign} tone="success" caption={`${fmtNum(data?.totalSkus || 0)} SKUs`} />
            <StatCard title="Fixed Asset Count" value={fmtNum(data?.totalAssets || 0)} icon={Monitor} tone="info" />
            <StatCard title="Asset Value Ref" value={money(data?.assetValue || 0)} icon={Building2} tone="success" />
            <StatCard title="Stock Accuracy" value="—" icon={ShieldCheck} tone="neutral" caption="Via counts" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Waste Value" value={money(data?.wasteValue || 0)} icon={Trash2} tone="danger" />
            <StatCard title="Expiry Value" value={data?.expiredCount || 0} icon={CalendarClock} tone="warning" caption={`${data?.expiringCount || 0} expiring`} />
            <StatCard title="Missing Assets" value={data?.missingAssets || 0} icon={AlertTriangle} tone="danger" />
            <StatCard title="Inventory Variance" value={money(data?.inventoryVariance || 0)} icon={Scale} tone={data && data.inventoryVariance < 0 ? 'danger' : 'neutral'} />
          </div>
        </>
      )}

      {/* ── Inventory Manager View (spec §69) ── */}
      {role === 'inventory-manager' && (
        <>
          <div className={layout.kpiGrid}>
            <StatCard title="Stock On Hand" value={fmtNum(data?.onHand || 0)} icon={Package} tone="info" caption={`Available: ${fmtNum(data?.available || 0)}`} />
            <StatCard title="Low Stock" value={data?.lowStockCount || 0} icon={AlertTriangle} tone="warning" caption={`${data?.outOfStockCount || 0} out of stock`} />
            <StatCard title="Reserved" value={fmtNum(data?.reserved || 0)} icon={ClipboardList} tone="neutral" caption={`${reservations.length} active`} />
            <StatCard title="Pending Receipts" value={data?.pendingReceipts || 0} icon={Truck} tone="info" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Pending Issues" value={data?.pendingIssues || 0} icon={ClipboardList} tone="accent" />
            <StatCard title="Pending Transfers" value={data?.pendingTransfers || 0} icon={ArrowLeftRight} tone="neutral" />
            <StatCard title="Expiring Soon" value={data?.expiringCount || 0} icon={CalendarClock} tone="warning" caption={`${data?.expiredCount || 0} expired`} />
            <StatCard title="Inventory Variance" value={money(data?.inventoryVariance || 0)} icon={Scale} tone={data && data.inventoryVariance < 0 ? 'danger' : 'neutral'} />
          </div>
        </>
      )}

      {/* ── Asset Manager View (spec §69) ── */}
      {role === 'asset-manager' && (
        <>
          <div className={layout.kpiGrid}>
            <StatCard title="Total Assets" value={fmtNum(assets.length)} icon={Monitor} tone="info" />
            <StatCard title="Asset Value" value={money(data?.assetValue || 0)} icon={DollarSign} tone="success" />
            <StatCard title="Missing Assets" value={data?.missingAssets || 0} icon={AlertTriangle} tone="danger" />
            <StatCard title="In Service" value={assetsByStatus['In Service'] || 0} icon={ShieldCheck} tone="success" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Assigned" value={assetsByStatus['Assigned'] || 0} icon={User} tone="info" />
            <StatCard title="Under Maintenance" value={assetsByStatus['Under Maintenance'] || 0} icon={Wrench} tone="warning" />
            <StatCard title="Tools Issued" value={toolsIssued} icon={Wrench} tone="info" caption={`${toolsAvailable} available`} />
            <StatCard title="Uniforms Assigned" value={uniformsAssigned} icon={Shirt} tone="neutral" />
          </div>
          {/* Assets by Department */}
          <SectionCard title="Assets by Department" subtitle="Top 5 departments" icon={Layers} pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
            {assetsByDept.length === 0 && <div className="p-6 text-sm text-gray-500">No asset data.</div>}
            {assetsByDept.map(([dept, count], i) => (
              <div key={i} className="p-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{dept}</p>
                <Badge tone="info">{count}</Badge>
              </div>
            ))}
          </SectionCard>
        </>
      )}

      {/* ── Storekeeper View (spec §69) ── */}
      {role === 'storekeeper' && (
        <>
          <div className={layout.kpiGrid}>
            <StatCard title="Pending Receipts" value={data?.pendingReceipts || 0} icon={Truck} tone="info" />
            <StatCard title="Pending Issues" value={data?.pendingIssues || 0} icon={ClipboardList} tone="accent" />
            <StatCard title="Pending Transfers" value={data?.pendingTransfers || 0} icon={ArrowLeftRight} tone="neutral" />
            <StatCard title="Active Reservations" value={reservations.length} icon={ClipboardList} tone="warning" />
          </div>
          <div className={layout.kpiGrid}>
            <StatCard title="Expiring Soon" value={data?.expiringCount || 0} icon={CalendarClock} tone="warning" />
            <StatCard title="Expired" value={data?.expiredCount || 0} icon={XCircle} tone="danger" />
            <StatCard title="Low Stock" value={data?.lowStockCount || 0} icon={AlertTriangle} tone="warning" />
            <StatCard title="Linen Below PAR" value={linenBelowPar} icon={BedDouble} tone="warning" />
          </div>
        </>
      )}

      {/* Lists — low stock / expiring / expired (shared across views) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard title="Low Stock Items" subtitle="At or below reorder point" icon={AlertTriangle} tone="warning" pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {loading && <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {!loading && (data?.lowStockItems || []).length === 0 && <div className="p-6 text-sm text-gray-500">No low stock items.</div>}
          {(data?.lowStockItems || []).slice(0, 8).map((it: any, i: number) => (
            <div key={i} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{it.item_name}</p>
                <p className="text-xs text-gray-500">{it.unit_of_measure}</p>
              </div>
              <Badge tone="warning">Reorder ≤ {it.reorder_point}</Badge>
            </div>
          ))}
        </SectionCard>

        <SectionCard title="Expiring Items" subtitle="Within 30 days" icon={CalendarClock} tone="warning" pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {loading && <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {!loading && (data?.expiringItems || []).length === 0 && <div className="p-6 text-sm text-gray-500">No items expiring soon.</div>}
          {(data?.expiringItems || []).slice(0, 8).map((b: any, i: number) => (
            <div key={i} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.batch_number}</p>
                <p className="text-xs text-gray-500">Qty: {b.quantity} · Exp: {b.expiry_date}</p>
              </div>
              <Badge tone={b.daysUntilExpiry <= 7 ? 'danger' : 'warning'}>{b.daysUntilExpiry}d</Badge>
            </div>
          ))}
        </SectionCard>

        <SectionCard title="Expired Items" subtitle="Past expiry date" icon={XCircle} tone="danger" pad="none" bodyClassName="divide-y divide-gray-100 dark:divide-slate-700">
          {loading && <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
          {!loading && (data?.expiredItems || []).length === 0 && <div className="p-6 text-sm text-gray-500">No expired items.</div>}
          {(data?.expiredItems || []).slice(0, 8).map((b: any, i: number) => (
            <div key={i} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.batch_number}</p>
                <p className="text-xs text-gray-500">Qty: {b.quantity} · Exp: {b.expiry_date}</p>
              </div>
              <Badge tone="danger" variant="solid">Expired</Badge>
            </div>
          ))}
        </SectionCard>
      </div>

      {/* Search result detail modal */}
      <ModalSystem
        isOpen={!!searchSelected}
        onClose={() => setSearchSelected(null)}
        title={searchSelected ? `${searchSelected.type} Details` : ''}
        size="md"
      >
        {searchSelected && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Type</p>
                <p className="text-gray-900 dark:text-white">{searchSelected.type}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">ID</p>
                <p className="text-gray-900 dark:text-white font-mono text-xs">{searchSelected.id}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Label</p>
                <p className="text-gray-900 dark:text-white">{searchSelected.label}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Reference</p>
                <p className="text-gray-900 dark:text-white">{searchSelected.reference || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Location</p>
                <p className="text-gray-900 dark:text-white">{searchSelected.location || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase">Status</p>
                {searchSelected.status ? <Badge tone={toneForSearch(searchSelected.status)}>{searchSelected.status}</Badge> : <p className="text-gray-400">—</p>}
              </div>
              <div className="col-span-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Subtitle</p>
                <p className="text-gray-900 dark:text-white">{searchSelected.subtitle || '—'}</p>
              </div>
            </div>
          </div>
        )}
      </ModalSystem>
    </div>
  );
};

export default UnifiedInventoryDashboard;
