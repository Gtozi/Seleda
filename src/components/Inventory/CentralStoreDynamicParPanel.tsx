/**
 * Central Store Dynamic Par Panel — embedded in the Replenishment module.
 *
 * Shows the Central Store (Main Warehouse) dynamic Min / ROP / Par Level
 * calculated from aggregated department demand using the formula:
 *
 *   ROP_Central = (D_Total × LT_Vendor) + SS_Central
 *
 * Where D_Total is the combined avg daily usage across all department
 * stores, LT_Vendor is the external supplier lead time, and SS_Central
 * is the central safety stock (bulletproof or statistical method).
 *
 * Uses uinv_central_store_stats (migration 376) + uinv_dynamic_par_config.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, RefreshCw, Loader2, ServerCrash, Warehouse, Shield,
  TrendingDown, ChevronDown, ChevronRight, Settings,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchCentralStoreStats,
  calculateCentralDynamicPar,
  fetchCentralStoreConfig,
  saveCentralStoreConfig,
  type CentralStoreStat,
  type CentralStoreConfig,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell } from './InventoryTable';

const LOOKBACK_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
];

const CentralStoreDynamicParPanel: React.FC = () => {
  const { currentPropertyId, addNotification } = useERP();
  const [stats, setStats] = useState<CentralStoreStat[]>([]);
  const [configs, setConfigs] = useState<CentralStoreConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [calculating, setCalculating] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<CentralStoreConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, configData] = await Promise.all([
        fetchCentralStoreStats({
          propertyId: currentPropertyId || undefined,
          lookbackDays: String(lookbackDays),
        }).catch(() => [] as CentralStoreStat[]),
        fetchCentralStoreConfig().catch(() => [] as CentralStoreConfig[]),
      ]);
      setStats(statsData);
      setConfigs(configData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load central store par data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, lookbackDays]);

  useEffect(() => { load(); }, [load]);

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      const result = await calculateCentralDynamicPar(lookbackDays, currentPropertyId || undefined);
      addNotification(
        `Central par recalculated: ${result.generated} item(s). ` +
        `ROP = D_Total × LT_Vendor + SS_Central.`,
        'success',
        'Inventory',
      );
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to recalculate central par', 'error', 'Inventory');
    } finally {
      setCalculating(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!editingConfig) return;
    setSavingConfig(true);
    try {
      await saveCentralStoreConfig({
        property_id: editingConfig.property_id,
        item_id: editingConfig.item_id,
        lookback_days: editingConfig.lookback_days,
        lead_time_days: editingConfig.lead_time_days,
        safety_stock_days: editingConfig.safety_stock_days,
        reorder_cycle_days: editingConfig.reorder_cycle_days,
        service_level: editingConfig.service_level,
        is_enabled: editingConfig.is_enabled,
        min_replenish_threshold: editingConfig.min_replenish_threshold,
        safety_stock_method: editingConfig.safety_stock_method,
        lead_time_stddev_days: editingConfig.lead_time_stddev_days,
      });
      addNotification('Central par config saved.', 'success', 'Inventory');
      setEditingConfig(null);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to save config', 'error', 'Inventory');
    } finally {
      setSavingConfig(false);
    }
  };

  const summary = useMemo(() => {
    const totalItems = stats.length;
    const totalDemand = stats.reduce((s, r) => s + Number(r.d_total || 0), 0);
    const bulletproof = stats.filter(r => r.safety_stock_method === 'bulletproof').length;
    const belowRop = stats.filter(r => {
      const onHand = Number(r.balance?.on_hand || 0);
      return onHand <= Number(r.central_rop || 0) && Number(r.central_rop || 0) > 0;
    }).length;
    return { totalItems, totalDemand, bulletproof, belowRop };
  }, [stats]);

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Central Store Dynamic Par"
        subtitle="Main Warehouse Min / ROP / Par Level derived from aggregated department demand. ROP = D_Total × LT_Vendor + SS_Central."
        icon={Warehouse}
        actions={
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]"
              value={lookbackDays}
              onChange={e => setLookbackDays(Number(e.target.value))}
            >
              {LOOKBACK_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
            </button>
            <button onClick={() => setShowConfig(!showConfig)}
              className={button.secondary + (showConfig ? ' ring-2 ring-purple-400' : '')}>
              <Settings className="w-4 h-4" /> Config
            </button>
            <button onClick={handleRecalculate} disabled={calculating} className={button.primary + ' disabled:opacity-50'}>
              {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Recalculate
            </button>
          </div>
        }
      />

      <div className={layout.kpiGrid}>
        <StatCard title="Tracked Items" value={summary.totalItems} icon={Warehouse} tone="accent" />
        <StatCard title="Total Daily Demand" value={summary.totalDemand.toFixed(1)} icon={TrendingDown} tone="info" />
        <StatCard title="Bulletproof SS" value={summary.bulletproof} icon={Shield} tone="success" />
        <StatCard title="Below Central ROP" value={summary.belowRop} icon={Activity} tone="danger" />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Central Store Stats Table */}
      <SectionCard pad="md">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-indigo-500" />
          Central Store Par Calculation ({lookbackDays}-day lookback)
        </h3>
        <InventoryTable
          rows={stats}
          rowKey={(s) => s.item_id}
          loading={loading}
          loadingMessage="Loading central store stats…"
          error={error}
          onRetry={load}
          emptyMessage="No central par data yet. Click Recalculate to aggregate department demand."
          columns={[
            {
              key: 'item',
              header: 'Item',
              widthClass: 'md:w-48 shrink-0',
              render: (s) => (
                <button
                  className="flex items-center gap-1 text-left"
                  onClick={() => setExpandedRow(expandedRow === s.item_id ? null : s.item_id)}
                >
                  {expandedRow === s.item_id
                    ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                  <IdentityCell
                    icon={<Warehouse size={16} />}
                    soft={statusTone.neutral.soft}
                    text={statusTone.neutral.text}
                    name={s.item?.item_name || s.item_id}
                    code={s.item?.item_code || ''}
                  />
                </button>
              ),
            },
            {
              key: 'onHand',
              header: 'On Hand',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => {
                const onHand = Number(s.balance?.on_hand || 0);
                const rop = Number(s.central_rop || 0);
                const below = rop > 0 && onHand <= rop;
                return (
                  <span className={`text-sm tabular-nums font-bold ${below ? 'text-red-600' : 'text-slate-700 dark:text-slate-200'}`}>
                    {onHand.toFixed(1)}
                  </span>
                );
              },
            },
            {
              key: 'dTotal',
              header: 'D_Total',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{Number(s.d_total || 0).toFixed(2)}</span>,
            },
            {
              key: 'lt',
              header: 'LT (days)',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{Number(s.vendor_lead_time_days || 0).toFixed(0)}</span>,
            },
            {
              key: 'ss',
              header: 'SS_Central',
              widthClass: 'md:w-28 shrink-0',
              align: 'right',
              render: (s) => (
                <div className="flex flex-col items-end">
                  <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{Number(s.ss_central || 0).toFixed(1)}</span>
                  <span className="text-[10px] text-slate-400">{s.safety_stock_method === 'bulletproof' ? 'bulletproof' : 'statistical'}</span>
                </div>
              ),
            },
            {
              key: 'min',
              header: 'Min',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-amber-600">{Number(s.central_min || 0).toFixed(1)}</span>,
            },
            {
              key: 'rop',
              header: 'ROP',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm font-bold tabular-nums text-orange-600">{Number(s.central_rop || 0).toFixed(1)}</span>,
            },
            {
              key: 'par',
              header: 'Par',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm font-bold tabular-nums text-emerald-600">{Number(s.central_par || 0).toFixed(1)}</span>,
            },
            {
              key: 'deptPar',
              header: 'Σ Dept Par',
              widthClass: 'md:w-28 shrink-0',
              align: 'right',
              render: (s) => <span className="text-xs tabular-nums text-slate-400">{Number(s.combined_dept_par || 0).toFixed(1)}</span>,
            },
          ]}
        />

        {/* Expanded department breakdown */}
        {expandedRow && stats.find(s => s.item_id === expandedRow) && (
          <div className="mt-3 ml-6 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 p-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Department Demand Breakdown
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 uppercase tracking-wide">
                    <th className="text-left px-2 py-1 font-bold">Store</th>
                    <th className="text-left px-2 py-1 font-bold">Department</th>
                    <th className="text-right px-2 py-1 font-bold">Avg Daily</th>
                    <th className="text-right px-2 py-1 font-bold">Dept Par</th>
                    <th className="text-right px-2 py-1 font-bold">Dept Min</th>
                    <th className="text-right px-2 py-1 font-bold">Order Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats.find(s => s.item_id === expandedRow)!.dept_breakdown || []).map((d, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="px-2 py-1 text-slate-700 dark:text-slate-300">{d.storeName || d.storeId}</td>
                      <td className="px-2 py-1 text-slate-500">{d.department || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-slate-400">{Number(d.avgDaily || 0).toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-slate-400">{Number(d.dynamicPar || 0).toFixed(1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-amber-600">{Number(d.dynamicMin || 0).toFixed(1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-emerald-600">{Number(d.orderQty || 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Config Panel */}
      {showConfig && (
        <SectionCard pad="md">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4 text-purple-500" />
            Central Store Par Configuration
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Config rows scoped to the Main Warehouse (store_id = UINV-ST-MAIN). The <strong>global default</strong> row
            (store_id = null) applies to all items without an item-specific override. <strong>Lead Time</strong> = vendor
            lead time (external supplier → central shelf).
          </p>
          <InventoryTable
            rows={configs}
            rowKey={(c) => c.id}
            loading={loading}
            emptyMessage="No config rows — using built-in defaults (LT=5d, bulletproof)."
            columns={[
              {
                key: 'scope',
                header: 'Scope',
                widthClass: 'md:w-40 shrink-0',
                render: (c) => (
                  <div className="flex items-center gap-2">
                    <IdentityCell
                      icon={<Settings size={16} />}
                      soft={statusTone.neutral.soft}
                      text={statusTone.neutral.text}
                      name={c.item_id ? (c.item?.item_name || 'Item override') : (c.store_id ? 'Main Store default' : 'Global default')}
                      code={c.item?.item_code || ''}
                    />
                  </div>
                ),
              },
              {
                key: 'lt',
                header: 'Vendor LT',
                widthClass: 'md:w-24 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{c.lead_time_days}d</span>,
              },
              {
                key: 'method',
                header: 'SS Method',
                widthClass: 'md:w-28 shrink-0',
                render: (c) => (
                  <Badge tone={c.safety_stock_method === 'bulletproof' ? 'success' : 'info'}>
                    {c.safety_stock_method}
                  </Badge>
                ),
              },
              {
                key: 'cycle',
                header: 'Cycle',
                widthClass: 'md:w-20 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{c.reorder_cycle_days}d</span>,
              },
              {
                key: 'service',
                header: 'Service',
                widthClass: 'md:w-20 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{(Number(c.service_level || 0) * 100).toFixed(0)}%</span>,
              },
              {
                key: 'ltStddev',
                header: 'σ_LT',
                widthClass: 'md:w-20 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{Number(c.lead_time_stddev_days || 0).toFixed(1)}</span>,
              },
              {
                key: 'enabled',
                header: 'Status',
                widthClass: 'md:w-24 shrink-0',
                render: (c) => <Badge tone={c.is_enabled ? 'success' : 'neutral'}>{c.is_enabled ? 'Active' : 'Disabled'}</Badge>,
              },
              {
                key: 'actions',
                header: '',
                widthClass: 'md:w-20 shrink-0',
                render: (c) => (
                  <button onClick={() => setEditingConfig(c)} className={button.ghost + ' text-xs'}>
                    Edit
                  </button>
                ),
              },
            ]}
          />
        </SectionCard>
      )}

      {/* Config Edit Modal */}
      {editingConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-gray-200 dark:border-slate-700 p-5">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4">
              Edit Central Par Config — {editingConfig.item_id ? (editingConfig.item?.item_name || 'Item') : (editingConfig.store_id ? 'Main Store default' : 'Global default')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Vendor Lead Time (days)</span>
                <input type="number" className={inputClass} value={editingConfig.lead_time_days}
                  onChange={e => setEditingConfig({ ...editingConfig, lead_time_days: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Reorder Cycle (days)</span>
                <input type="number" className={inputClass} value={editingConfig.reorder_cycle_days}
                  onChange={e => setEditingConfig({ ...editingConfig, reorder_cycle_days: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Safety Stock Method</span>
                <select className={inputClass} value={editingConfig.safety_stock_method}
                  onChange={e => setEditingConfig({ ...editingConfig, safety_stock_method: e.target.value as 'bulletproof' | 'statistical' })}>
                  <option value="bulletproof">bulletproof (zero risk)</option>
                  <option value="statistical">statistical (standard risk)</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Service Level</span>
                <select className={inputClass} value={editingConfig.service_level}
                  onChange={e => setEditingConfig({ ...editingConfig, service_level: Number(e.target.value) })}>
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Lead Time σ (days)</span>
                <input type="number" step="0.1" className={inputClass} value={editingConfig.lead_time_stddev_days}
                  onChange={e => setEditingConfig({ ...editingConfig, lead_time_stddev_days: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Safety Stock Days</span>
                <input type="number" className={inputClass} value={editingConfig.safety_stock_days}
                  onChange={e => setEditingConfig({ ...editingConfig, safety_stock_days: Number(e.target.value) })} />
              </label>
              <label className="block col-span-2">
                <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Lookback (days)</span>
                <input type="number" className={inputClass} value={editingConfig.lookback_days}
                  onChange={e => setEditingConfig({ ...editingConfig, lookback_days: Number(e.target.value) })} />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditingConfig(null)} className={button.ghost}>Cancel</button>
              <button onClick={handleSaveConfig} disabled={savingConfig} className={button.primary + ' disabled:opacity-50'}>
                {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CentralStoreDynamicParPanel;
