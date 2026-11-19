/**
 * Department Consumption Panel — embedded in department portals.
 *
 * Lets any department post consumption against their department store
 * stock (spec §61–§66). Covers spa treatments, FO amenities, banquet
 * events, HK supplies, engineering materials, etc.
 *
 * Uses the unified uinv_stock_balances system as the single source of truth.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Package, Plus, Clock, Loader2, ServerCrash, ChevronRight, Trash2,
  TrendingDown, AlertTriangle,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchStockByDepartment, postDepartmentConsumption, fetchDepartmentConsumption,
  type UinvStockBalance,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell, StockCell, OpsCell, IconButton } from './InventoryTable';

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

interface Props {
  department: string;
  /** Optional context for the consumption (e.g. "Spa Treatment", "Banquet Event", "Guest Amenity"). */
  referenceType?: string;
  /** Hide the internal KPI stat cards (when embedded in a module that has its own dynamic cards) */
  hideStats?: boolean;
  /** Hide the internal PageHeader (when embedded in a module that has its own header) */
  hideHeader?: boolean;
}

const DepartmentConsumptionPanel: React.FC<Props> = ({ department, referenceType, hideStats, hideHeader }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [stock, setStock] = useState<UinvStockBalance[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formLines, setFormLines] = useState<{ itemId: string; itemName: string; quantity: number; unitCost: number; reason: string }[]>([]);
  const [formConsumedBy, setFormConsumedBy] = useState('');
  const [formReferenceNumber, setFormReferenceNumber] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockData, histData] = await Promise.all([
        fetchStockByDepartment(department, currentPropertyId || undefined).catch(() => [] as UinvStockBalance[]),
        fetchDepartmentConsumption(department, { propertyId: currentPropertyId || undefined, limit: 50 }).catch(() => []),
      ]);
      setStock(stockData);
      setHistory(histData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load consumption data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, department]);

  useEffect(() => { load(); }, [load]);

  const totalStockValue = useMemo(() =>
    stock.reduce((s, r) => s + (Number(r.on_hand) * Number(r.unit_cost || 0)), 0), [stock]);

  const openCreateForm = () => {
    setFormLines([{ itemId: '', itemName: '', quantity: 1, unitCost: 0, reason: '' }]);
    setFormConsumedBy('');
    setFormReferenceNumber('');
    setFormNotes('');
    setShowForm(true);
  };

  const addLine = () => {
    setFormLines(prev => [...prev, { itemId: '', itemName: '', quantity: 1, unitCost: 0, reason: '' }]);
  };

  const removeLine = (idx: number) => {
    setFormLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: string, value: any) => {
    setFormLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'itemId') {
        const item = stock.find(s => s.item_id === value);
        return { ...l, itemId: value, itemName: item?.item_name || '', unitCost: Number(item?.unit_cost || 0) };
      }
      return { ...l, [field]: value };
    }));
  };

  const submitConsumption = async () => {
    const validLines = formLines.filter(l => l.itemId && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('Please add at least one item with a valid quantity', 'warning', department);
      return;
    }
    setSubmitting(true);
    try {
      const result = await postDepartmentConsumption({
        property_id: currentPropertyId || null,
        department,
        consumed_by: formConsumedBy || undefined,
        reference_type: referenceType || undefined,
        reference_number: formReferenceNumber || undefined,
        notes: formNotes || undefined,
        lines: validLines.map(l => ({
          item_id: l.itemId,
          quantity: l.quantity,
          unit_cost: l.unitCost,
          reason: l.reason || undefined,
        })),
      });
      const failed = result.results.filter((r: any) => !r.success);
      if (failed.length > 0) {
        addNotification(`${result.results.length - failed.length} item(s) consumed. ${failed.length} failed.`, 'warning', department);
      } else {
        addNotification(`Consumption recorded: ${result.consumption_number}`, 'success', department);
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to record consumption', 'error', department);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      {!hideHeader && (
        <PageHeader
          title="Inventory Consumption"
          subtitle={`Record consumption of inventory items for ${department}. Stock is deducted from your department store.`}
          icon={TrendingDown}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
              </button>
              <button onClick={openCreateForm} className={button.primary}>
                <Plus className="w-4 h-4" /> Record Consumption
              </button>
            </div>
          }
        />
      )}

      {!hideStats && (
        <div className={layout.kpiGrid}>
          <StatCard title="Items in Stock" value={stock.length} icon={Package} tone="accent" />
          <StatCard title="Stock Value" value={`$${totalStockValue.toFixed(2)}`} icon={TrendingDown} tone="info" />
          <StatCard title="Consumption Records" value={history.length} icon={Clock} tone="neutral" />
        </div>
      )}

      {(hideHeader || hideStats) && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={load} disabled={loading} className={button.secondary + ' disabled:opacity-50'}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
          </button>
          <button onClick={openCreateForm} className={button.primary}>
            <Plus className="w-4 h-4" /> Record Consumption
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Current Department Stock */}
      <SectionCard pad="md">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Current Department Stock</h3>
        <InventoryTable
          rows={stock}
          rowKey={(s) => s.id}
          loading={loading}
          loadingMessage="Loading stock…"
          error={error}
          onRetry={load}
          emptyMessage="No stock in your department store."
          columns={[
            {
              key: 'item',
              header: 'Item',
              widthClass: 'md:w-64 shrink-0',
              render: (s) => (
                <IdentityCell
                  icon={<Package size={16} />}
                  soft={statusTone.neutral.soft}
                  text={statusTone.neutral.text}
                  name={s.item_name || s.item_id}
                  code={s.item_code || ''}
                />
              ),
            },
            {
              key: 'on_hand',
              header: 'On Hand',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <StockCell qty={s.on_hand} />,
            },
            {
              key: 'unit_cost',
              header: 'Unit Cost',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">${Number(s.unit_cost || 0).toFixed(2)}</span>,
            },
            {
              key: 'value',
              header: 'Value',
              widthClass: 'md:w-28 shrink-0',
              align: 'right',
              render: (s) => <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">${(Number(s.on_hand) * Number(s.unit_cost || 0)).toFixed(2)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              widthClass: 'md:w-28 shrink-0',
              render: (s) => <Badge tone={Number(s.on_hand) <= 10 ? 'warning' : 'success'}>{s.status || 'Available'}</Badge>,
            },
          ]}
        />
      </SectionCard>

      {/* Consumption History */}
      <SectionCard pad="md">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Recent Consumption</h3>
        <InventoryTable
          rows={history}
          rowKey={(h) => h.id}
          loading={loading}
          emptyMessage="No consumption recorded yet."
          columns={[
            {
              key: 'item',
              header: 'Item',
              widthClass: 'md:w-64 shrink-0',
              render: (h) => (
                <IdentityCell
                  icon={<TrendingDown size={16} />}
                  soft={statusTone.neutral.soft}
                  text={statusTone.neutral.text}
                  name={h.uinv_items?.item_name || h.item_id}
                  code={h.uinv_items?.item_code || ''}
                />
              ),
            },
            {
              key: 'qty',
              header: 'Qty Out',
              widthClass: 'md:w-24 shrink-0',
              align: 'right',
              render: (h) => <span className="text-sm font-bold tabular-nums text-red-600">-{h.quantity_out}</span>,
            },
            {
              key: 'value',
              header: 'Value',
              widthClass: 'md:w-28 shrink-0',
              align: 'right',
              render: (h) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">${Number(h.value || 0).toFixed(2)}</span>,
            },
            {
              key: 'ref',
              header: 'Reference',
              widthClass: 'md:w-40 shrink-0',
              render: (h) => <span className="text-sm text-slate-500 dark:text-slate-400">{h.reference || '—'}</span>,
            },
            {
              key: 'by',
              header: 'By',
              widthClass: 'md:w-32 shrink-0',
              render: (h) => <span className="text-sm text-slate-500 dark:text-slate-400">{h.performed_by || '—'}</span>,
            },
            {
              key: 'date',
              header: 'Date',
              widthClass: 'md:w-32 shrink-0',
              render: (h) => <span className="text-sm text-slate-500 dark:text-slate-400">{h.transaction_date?.slice(0, 10)}</span>,
            },
          ]}
        />
      </SectionCard>

      {/* Create Consumption Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} variant="form" size="lg"
        title="Record Consumption"
        subtitle={`Deduct inventory items for ${department}`}
        confirmLabel="Submit Consumption" onConfirm={submitConsumption} loading={submitting} confirmColor="emerald">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Consumed By</span>
              <input className={inputClass} value={formConsumedBy} onChange={e => setFormConsumedBy(e.target.value)} placeholder="Your name" />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Reference Number</span>
              <input className={inputClass} value={formReferenceNumber} onChange={e => setFormReferenceNumber(e.target.value)} placeholder="e.g. SPA-001, EVT-002" />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes</span>
              <input className={inputClass} value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Optional notes" />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items to Consume</span>
              <button onClick={addLine} className={button.ghost + ' text-xs'}><Plus className="w-3 h-3" /> Add Item</button>
            </div>
            <div className="space-y-2">
              {formLines.map((line, idx) => {
                const stockItem = stock.find(s => s.item_id === line.itemId);
                const available = stockItem ? Number(stockItem.on_hand) : 0;
                const insufficient = line.quantity > available;
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <select className={inputClass + ' flex-1'} value={line.itemId} onChange={e => updateLine(idx, 'itemId', e.target.value)}>
                      <option value="">Select item…</option>
                      {stock.map(s => (
                        <option key={s.item_id} value={s.item_id}>{s.item_name} (On hand: {s.on_hand})</option>
                      ))}
                    </select>
                    <input type="number" min="1" className={inputClass + ' w-24 text-center'} value={line.quantity}
                      onChange={e => updateLine(idx, 'quantity', +e.target.value)} />
                    <input type="number" min="0" step="0.01" className={inputClass + ' w-24 text-center'} value={line.unitCost}
                      onChange={e => updateLine(idx, 'unitCost', +e.target.value)} placeholder="Cost" />
                    <input className={inputClass + ' w-32'} value={line.reason} onChange={e => updateLine(idx, 'reason', e.target.value)} placeholder="Reason" />
                    {formLines.length > 1 && (
                      <button onClick={() => removeLine(idx)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {insufficient && line.itemId && (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ModalSystem>
    </div>
  );
};

export default DepartmentConsumptionPanel;
