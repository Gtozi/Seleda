/**
 * Department Dynamic Par Panel — embedded in department portals.
 *
 * Shows consumption-driven dynamic par levels for the department's
 * unified stores. Lets department users:
 *   - View historical consumption stats (avg daily, peak, volatility)
 *   - Recalculate dynamic par levels from recent ledger activity
 *   - See which items are below their dynamic min (need replenishment)
 *   - Trigger auto-replenishment from Central Warehouse
 *
 * Uses the unified uinv_consumption_stats + uinv_dynamic_par_config tables.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingDown, TrendingUp, Activity, RefreshCw, Loader2, ServerCrash,
  Zap, AlertTriangle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import {
  fetchDepartmentConsumptionStats,
  calculateDepartmentDynamicPar,
  fetchDepartmentDynamicParConfig,
  previewAutoReplenish,
  triggerAutoReplenish,
  type ConsumptionStat,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, StockCell } from './InventoryTable';

interface Props {
  department: string;
  hideStats?: boolean;
  hideHeader?: boolean;
  /** Increment to trigger a refresh from parent */
  refreshTrigger?: number;
  /** Increment to trigger recalculate from parent */
  recalculateTrigger?: number;
  /** Increment to trigger auto-replenish from parent */
  autoReplenishTrigger?: number;
}

const LOOKBACK_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
];

const DepartmentDynamicParPanel: React.FC<Props> = ({ department, hideStats, hideHeader, refreshTrigger, recalculateTrigger, autoReplenishTrigger }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [stats, setStats] = useState<ConsumptionStat[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);
  const [replenishPreview, setReplenishPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [calculating, setCalculating] = useState(false);
  const [replenishing, setReplenishing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, configData, previewData] = await Promise.all([
        fetchDepartmentConsumptionStats(department, {
          propertyId: currentPropertyId || undefined,
          lookbackDays: String(lookbackDays),
        }).catch(() => [] as ConsumptionStat[]),
        fetchDepartmentDynamicParConfig(department).catch(() => []),
        previewAutoReplenish(currentPropertyId || undefined).catch(() => null),
      ]);
      setStats(statsData);
      setConfigs(configData);
      setReplenishPreview(previewData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dynamic par data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, department, lookbackDays]);

  useEffect(() => { load(); }, [load]);

  // External trigger: refresh
  useEffect(() => { if (refreshTrigger && refreshTrigger > 0) load(); }, [refreshTrigger]);

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      const result = await calculateDepartmentDynamicPar(department, lookbackDays, currentPropertyId || undefined);
      addNotification(
        `Dynamic par recalculated: ${result.generated} item(s) for ${department}`,
        'success',
        department as any,
      );
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to recalculate dynamic par', 'error', department as any);
    } finally {
      setCalculating(false);
    }
  };

  const handleAutoReplenish = async () => {
    setReplenishing(true);
    try {
      const result = await triggerAutoReplenish(currentPropertyId || undefined);
      addNotification(
        `Auto-replenishment: ${result.generated} transfer(s) created from Central Warehouse`,
        result.generated > 0 ? 'success' : 'warning',
        department as any,
      );
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Auto-replenishment failed', 'error', department as any);
    } finally {
      setReplenishing(false);
    }
  };

  // External trigger: recalculate
  useEffect(() => { if (recalculateTrigger && recalculateTrigger > 0) handleRecalculate(); }, [recalculateTrigger]);
  // External trigger: auto-replenish
  useEffect(() => { if (autoReplenishTrigger && autoReplenishTrigger > 0) handleAutoReplenish(); }, [autoReplenishTrigger]);

  // Filter replenish preview to this department's stores.
  // Uses the explicit `department` field on the preview item (populated
  // server-side from uinv_stores.department) with a name-based fallback
  // for stores that don't carry the department column yet.
  const deptPreviewItems = useMemo(() => {
    if (!replenishPreview?.items) return [];
    return replenishPreview.items.filter((i: any) => {
      if (i.department === department) return true;
      const sn = (i.storeName || '').toLowerCase();
      if (department === 'Engineering' && sn.includes('eng')) return true;
      if (department === 'Housekeeping' && (sn.includes('hk') || sn.includes('linen'))) return true;
      if (department === 'Food & Beverage' && (sn.includes('food') || sn.includes('bev'))) return true;
      if (department === 'Banquet & Events' && (sn.includes('banquet') || sn.includes('event'))) return true;
      return false;
    });
  }, [replenishPreview, department]);

  const summary = useMemo(() => {
    const totalItems = stats.length;
    const avgDailyTotal = stats.reduce((s, r) => s + Number(r.avg_daily_consumption || 0), 0);
    const belowMin = stats.filter(r => Number(r.dynamic_replenish_min || 0) > 0).length;
    const highVolatility = stats.filter(r => Number(r.consumption_stddev || 0) > Number(r.avg_daily_consumption || 0)).length;
    return { totalItems, avgDailyTotal, belowMin, highVolatility };
  }, [stats]);

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      {!hideHeader && (
      <PageHeader
        title="Dynamic Par Levels"
        subtitle={`Consumption-driven par levels for ${department} based on historical ledger data.`}
        icon={Activity}
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
            <button onClick={handleRecalculate} disabled={calculating} className={button.secondary + ' disabled:opacity-50'}>
              {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Recalculate
            </button>
            <button onClick={handleAutoReplenish} disabled={replenishing} className={button.primary + ' disabled:opacity-50'}>
              {replenishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Auto-Replenish
            </button>
          </div>
        }
      />
      )}
      {hideHeader && (
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
        </div>
      )}

      {!hideStats && (
      <div className={layout.kpiGrid}>
        <StatCard title="Tracked Items" value={summary.totalItems} icon={Activity} tone="accent" />
        <StatCard title="Avg Daily Consumption" value={summary.avgDailyTotal.toFixed(1)} icon={TrendingDown} tone="info" />
        <StatCard title="High Volatility" value={summary.highVolatility} icon={AlertTriangle} tone="warning" />
        <StatCard title="Replenish Needed" value={deptPreviewItems.length} icon={Zap} tone="danger" />
      </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Replenishment Preview */}
      {deptPreviewItems.length > 0 && (
        <SectionCard pad="md">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Items Below Replenish Min — {deptPreviewItems.length}
          </h3>
          <InventoryTable
            rows={deptPreviewItems}
            rowKey={(i: any) => i.balanceId || i.itemId}
            loading={loading}
            emptyMessage="No items need replenishment."
            columns={[
              {
                key: 'item',
                header: 'Item',
                widthClass: 'md:w-48 shrink-0',
                render: (i: any) => (
                  <IdentityCell
                    icon={<TrendingDown size={16} />}
                    soft={statusTone.warning.soft}
                    text={statusTone.warning.text}
                    name={i.itemName || 'Unknown'}
                    code={i.itemCode || ''}
                  />
                ),
              },
              {
                key: 'onHand',
                header: 'On Hand',
                widthClass: 'md:w-24 shrink-0',
                align: 'right',
                render: (i: any) => <StockCell value={i.onHand} />,
              },
              {
                key: 'min',
                header: 'Min',
                widthClass: 'md:w-24 shrink-0',
                align: 'right',
                render: (i: any) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{i.replenishMin}</span>,
              },
              {
                key: 'max',
                header: 'Max',
                widthClass: 'md:w-24 shrink-0',
                align: 'right',
                render: (i: any) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{i.replenishMax}</span>,
              },
              {
                key: 'suggested',
                header: 'Suggested Qty',
                widthClass: 'md:w-28 shrink-0',
                align: 'right',
                render: (i: any) => <span className="text-sm font-bold tabular-nums text-emerald-600">+{i.suggestedQty}</span>,
              },
              {
                key: 'store',
                header: 'Store',
                widthClass: 'md:w-32 shrink-0',
                render: (i: any) => <span className="text-sm text-slate-500 dark:text-slate-400">{i.storeName || '—'}</span>,
              },
            ]}
          />
        </SectionCard>
      )}

      {/* Consumption Stats Table */}
      <SectionCard pad="md">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
          Consumption Analysis & Dynamic Par ({lookbackDays}-day lookback)
        </h3>
        <InventoryTable
          rows={stats}
          rowKey={(s) => s.id}
          loading={loading}
          loadingMessage="Loading consumption stats…"
          error={error}
          onRetry={load}
          emptyMessage="No consumption stats yet. Click Recalculate to generate from ledger history."
          columns={[
            {
              key: 'item',
              header: 'Item',
              widthClass: 'md:w-48 shrink-0',
              render: (s) => (
                <IdentityCell
                  icon={<Activity size={16} />}
                  soft={statusTone.neutral.soft}
                  text={statusTone.neutral.text}
                  name={s.item?.item_name || s.item_id}
                  code={s.item?.item_code || ''}
                />
              ),
            },
            {
              key: 'avgDaily',
              header: 'Avg Daily',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{Number(s.avg_daily_consumption || 0).toFixed(2)}</span>,
            },
            {
              key: 'peak',
              header: 'Peak Day',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{Number(s.peak_daily_consumption || 0).toFixed(1)}</span>,
            },
            {
              key: 'volatility',
              header: 'Volatility',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => {
                const vol = Number(s.consumption_stddev || 0);
                const avg = Number(s.avg_daily_consumption || 0);
                const high = avg > 0 && vol > avg;
                return (
                  <span className={`text-sm tabular-nums ${high ? 'text-amber-600 font-bold' : 'text-slate-600 dark:text-slate-400'}`}>
                    {vol.toFixed(2)}
                  </span>
                );
              },
            },
            {
              key: 'dynPar',
              header: 'Dynamic Par',
              widthClass: 'md:w-28 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{Number(s.dynamic_par_level || 0).toFixed(1)}</span>,
            },
            {
              key: 'dynMin',
              header: 'Dyn. Min',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-amber-600">{Number(s.dynamic_replenish_min || 0).toFixed(1)}</span>,
            },
            {
              key: 'dynMax',
              header: 'Dyn. Max',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-emerald-600">{Number(s.dynamic_replenish_max || 0).toFixed(1)}</span>,
            },
            {
              key: 'store',
              header: 'Store',
              widthClass: 'md:w-32 shrink-0',
              render: (s) => <span className="text-sm text-slate-500 dark:text-slate-400">{s.store?.store_name || '—'}</span>,
            },
          ]}
        />
      </SectionCard>

      {/* Dynamic Par Config */}
      {configs.length > 0 && (
        <SectionCard pad="md">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
            Dynamic Par Config Overrides
          </h3>
          <InventoryTable
            rows={configs}
            rowKey={(c) => c.id}
            loading={loading}
            emptyMessage="No config overrides — using defaults."
            columns={[
              {
                key: 'item',
                header: 'Item',
                widthClass: 'md:w-48 shrink-0',
                render: (c) => (
                  <IdentityCell
                    icon={<TrendingUp size={16} />}
                    soft={statusTone.neutral.soft}
                    text={statusTone.neutral.text}
                    name={c.item?.item_name || 'All items'}
                    code={c.item?.item_code || ''}
                  />
                ),
              },
              {
                key: 'lookback',
                header: 'Lookback',
                widthClass: 'md:w-24 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{c.lookback_days}d</span>,
              },
              {
                key: 'leadTime',
                header: 'Lead Time',
                widthClass: 'md:w-24 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{c.lead_time_days}d</span>,
              },
              {
                key: 'safety',
                header: 'Safety Stock',
                widthClass: 'md:w-28 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{c.safety_stock_days}d</span>,
              },
              {
                key: 'serviceLevel',
                header: 'Service Level',
                widthClass: 'md:w-28 shrink-0',
                align: 'right',
                render: (c) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">{(Number(c.service_level || 0) * 100).toFixed(0)}%</span>,
              },
              {
                key: 'enabled',
                header: 'Status',
                widthClass: 'md:w-24 shrink-0',
                render: (c) => <Badge tone={c.is_enabled ? 'success' : 'neutral'}>{c.is_enabled ? 'Active' : 'Disabled'}</Badge>,
              },
            ]}
          />
        </SectionCard>
      )}
    </div>
  );
};

export default DepartmentDynamicParPanel;
