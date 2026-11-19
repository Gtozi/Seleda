/**
 * Valuation — /erp/inventory/valuation
 * DB-integrated via /api/uinv-portal/valuation.
 * Inventory valuation by method (weighted average / FIFO / standard) per spec §15.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Clock, Loader2, ServerCrash, Download, TrendingUp,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { useERP } from '../../context/ERPContext';
import { fetchValuation, type ValuationData } from '../../services/inventoryService';
import InventoryTable from './InventoryTable';
import PeriodSelector, { usePeriodRange } from './PeriodSelector';

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);

const METHODS = ['Weighted Average', 'FIFO', 'Standard Cost'] as const;
type Method = typeof METHODS[number];

const ValuationModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, formatAmount } = useERP();
  const [data, setData] = useState<ValuationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('Weighted Average');
  const { period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, activeRange, activeLabel } = usePeriodRange();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchValuation({
        propertyId: currentPropertyId || undefined,
        method,
        startDate: activeRange.from,
        endDate: activeRange.to,
      } as any);
      setData(d);
    } catch (e: any) {
      setError(e?.message || 'Failed to load valuation');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, method, activeRange.from, activeRange.to]);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => (formatAmount ? formatAmount(n) : fmtMoney(n));

  const lines = data?.valuation || [];

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Inventory Valuation"
        subtitle="Stock value by costing method."
        icon={DollarSign}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
            </button>
            <button className={button.secondary}><Download className="w-4 h-4" /> Export</button>
          </div>
        }
      />

      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1">
            {METHODS.map(m => (
              <button key={m} onClick={() => setMethod(m)}
                className={['px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap',
                  method === m ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'].join(' ')}>
                {m}
              </button>
            ))}
          </div>
          <Badge tone="info" variant="solid">{method}</Badge>
        </div>
      </SectionCard>

      <div className={layout.kpiGrid}>
        <StatCard title="Total Value" value={money(data?.grandTotal || 0)} icon={DollarSign} tone="success" />
        <StatCard title="Total Items" value={data?.totalItems || 0} icon={TrendingUp} tone="accent" />
        <StatCard title="Categories" value={Object.keys(data?.byCategory || {}).length} icon={DollarSign} tone="info" />
        <StatCard title="Avg Value / Item" value={money(data?.totalItems ? (data.grandTotal / data.totalItems) : 0)} icon={DollarSign} tone="neutral" />
      </div>

      {subTabBar}

      {/* Period selector */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{activeLabel}</span>
        </div>
      </SectionCard>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {loading && <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /> Loading valuation…</div>}
      {!loading && !error && lines.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No valuation data.</div>}
      {!loading && !error && lines.length > 0 && (
        <InventoryTable
          title="Valuation Detail"
          subtitle={`By ${method} · ${activeLabel}`}
          columns={[
            { key: 'item', header: 'Item', render: (l: any) => (
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{l.itemName}</p>
                <p className="text-xs text-slate-500 font-mono">{l.unitOfMeasure}</p>
              </div>
            )},
            { key: 'category', header: 'Category', render: (l: any) => <span className="text-slate-600 dark:text-slate-400">{l.category}</span> },
            { key: 'method', header: 'Method', render: (l: any) => <span className="text-slate-600 dark:text-slate-400">{l.costingMethod}</span> },
            { key: 'qty', header: 'Qty', align: 'right', render: (l: any) => <span className="text-slate-600 dark:text-slate-400">{l.totalQuantity}</span> },
            { key: 'avgCost', header: 'Avg Cost', align: 'right', render: (l: any) => <span className="text-slate-600 dark:text-slate-400">{money(l.avgUnitCost)}</span> },
            { key: 'value', header: 'Value', align: 'right', render: (l: any) => <span className="font-bold text-slate-900 dark:text-white">{money(l.totalValue)}</span> },
          ]}
          rows={lines}
          rowKey={(l: any, i: number) => String(l.itemId || i)}
          footer={
            <tr>
              <td colSpan={5} className="px-4 py-3 text-right text-slate-600 dark:text-slate-400 font-medium">Total</td>
              <td className="px-4 py-3 font-bold text-indigo-600 dark:text-indigo-400 text-right">{money(data?.grandTotal || 0)}</td>
            </tr>
          }
        />
      )}
    </div>
  );
};

export default ValuationModule;
