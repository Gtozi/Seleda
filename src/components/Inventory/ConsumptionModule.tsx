/**
 * Consumption — /erp/inventory/consumption
 * Cross-department consumption history. Shows Consumption ledger entries
 * across ALL department stores, with the ability to record consumption
 * for any department.
 *
 * DB-integrated via /api/uinv-portal/consumption + /api/uinv-portal/department-consumption.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  TrendingDown, Plus, Search, Clock, Loader2, ServerCrash, Trash2,
  Package, AlertTriangle, Filter,
} from 'lucide-react';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../FrontOffice/ui';
import { button, layout, statusTone } from '../FrontOffice/brandTheme';
import { ModalSystem } from '../Shared/ModalSystem';
import { useERP } from '../../context/ERPContext';
import {
  fetchConsumption, postDepartmentConsumption, fetchStock,
} from '../../services/inventoryService';
import InventoryTable, { IdentityCell } from './InventoryTable';

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

const DEPARTMENTS = [
  'All', 'Food & Beverage', 'Housekeeping', 'Engineering', 'Front Office',
  'Finance', 'Human Resources', 'Security', 'Procurement', 'Sales',
  'Transportation', 'Concierge', 'Spa & Wellness', 'Banquet & Events',
  'Operations', 'Admin', 'Executive',
];

const ConsumptionModule: React.FC<{ subTabBar?: React.ReactNode }> = ({ subTabBar }) => {
  const { currentPropertyId, addNotification } = useERP();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formDept, setFormDept] = useState('Food & Beverage');
  const [formConsumedBy, setFormConsumedBy] = useState('');
  const [formReferenceNumber, setFormReferenceNumber] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formLines, setFormLines] = useState<{ itemId: string; itemName: string; quantity: number; unitCost: number; reason: string }[]>([]);
  const [deptStock, setDeptStock] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConsumption({ propertyId: currentPropertyId || undefined, limit: 500 });
      setRecords(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load consumption records');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { load(); }, [load]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    let rows = records;
    if (deptFilter !== 'All') {
      rows = rows.filter((r: any) => r.store?.department === deptFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r: any) =>
        (r.item?.item_name || '').toLowerCase().includes(q) ||
        (r.item?.item_code || '').toLowerCase().includes(q) ||
        (r.reference || '').toLowerCase().includes(q) ||
        (r.performed_by || '').toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [records, deptFilter, search]);

  // KPIs
  const summary = useMemo(() => {
    const totalQty = filteredRecords.reduce((s, r) => s + Number(r.quantity_out || 0), 0);
    const totalValue = filteredRecords.reduce((s, r) => s + Number(r.value || 0), 0);
    const deptCount = new Set(filteredRecords.map((r: any) => r.store?.department).filter(Boolean)).size;
    const itemCount = new Set(filteredRecords.map((r: any) => r.item_id).filter(Boolean)).size;
    return { totalQty, totalValue, deptCount, itemCount };
  }, [filteredRecords]);

  // Per-department breakdown for the summary section
  const deptBreakdown = useMemo(() => {
    const map: Record<string, { qty: number; value: number; count: number }> = {};
    for (const r of filteredRecords) {
      const dept = (r as any).store?.department || 'Unknown';
      if (!map[dept]) map[dept] = { qty: 0, value: 0, count: 0 };
      map[dept].qty += Number((r as any).quantity_out || 0);
      map[dept].value += Number((r as any).value || 0);
      map[dept].count++;
    }
    return Object.entries(map).sort((a, b) => b[1].value - a[1].value);
  }, [filteredRecords]);

  // ── Record Consumption form helpers ──
  const openCreateForm = async () => {
    setFormLines([{ itemId: '', itemName: '', quantity: 1, unitCost: 0, reason: '' }]);
    setFormConsumedBy('');
    setFormReferenceNumber('');
    setFormNotes('');
    setShowForm(true);
    // Load stock for the selected department's store
    await loadDeptStock(formDept);
  };

  const loadDeptStock = async (department: string) => {
    try {
      const stock = await fetchStock({ propertyId: currentPropertyId || undefined, department });
      setDeptStock(stock || []);
    } catch {
      setDeptStock([]);
    }
  };

  const handleFormDeptChange = async (dept: string) => {
    setFormDept(dept);
    setFormLines([{ itemId: '', itemName: '', quantity: 1, unitCost: 0, reason: '' }]);
    await loadDeptStock(dept);
  };

  const addLine = () => setFormLines(prev => [...prev, { itemId: '', itemName: '', quantity: 1, unitCost: 0, reason: '' }]);
  const removeLine = (idx: number) => setFormLines(prev => prev.filter((_, i) => i !== idx));

  const updateLine = (idx: number, field: string, value: any) => {
    setFormLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'itemId') {
        const item = deptStock.find(s => s.item_id === value);
        return { ...l, itemId: value, itemName: item?.item_name || '', unitCost: Number(item?.unit_cost || 0) };
      }
      return { ...l, [field]: value };
    }));
  };

  const submitConsumption = async () => {
    const validLines = formLines.filter(l => l.itemId && l.quantity > 0);
    if (validLines.length === 0) {
      addNotification('Please add at least one item with a valid quantity', 'warning', 'Inventory');
      return;
    }
    setSubmitting(true);
    try {
      const result = await postDepartmentConsumption({
        property_id: currentPropertyId || null,
        department: formDept,
        consumed_by: formConsumedBy || undefined,
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
        addNotification(`${result.results.length - failed.length} item(s) consumed. ${failed.length} failed.`, 'warning', 'Inventory');
      } else {
        addNotification(`Consumption recorded: ${result.consumption_number}`, 'success', 'Inventory');
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to record consumption', 'error', 'Inventory');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Consumption"
        subtitle="Cross-department inventory consumption history. Record consumption against any department store."
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

      <div className={layout.kpiGrid}>
        <StatCard title="Total Consumed" value={summary.totalQty.toFixed(1)} icon={TrendingDown} tone="info" />
        <StatCard title="Consumption Value" value={`$${summary.totalValue.toFixed(2)}`} icon={TrendingDown} tone="danger" />
        <StatCard title="Departments" value={summary.deptCount} icon={Package} tone="accent" />
        <StatCard title="Items Consumed" value={summary.itemCount} icon={Package} tone="neutral" />
      </div>

      {subTabBar}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-2">
          <ServerCrash className="w-4 h-4 shrink-0" /> {error}
          <button onClick={load} className={button.ghost + ' ml-auto'}>Retry</button>
        </div>
      )}

      {/* Per-department breakdown */}
      {deptBreakdown.length > 0 && (
        <SectionCard pad="md">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            Consumption by Department
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 uppercase tracking-wide text-xs">
                  <th className="text-left px-3 py-2 font-bold">Department</th>
                  <th className="text-right px-3 py-2 font-bold">Records</th>
                  <th className="text-right px-3 py-2 font-bold">Qty Consumed</th>
                  <th className="text-right px-3 py-2 font-bold">Value</th>
                </tr>
              </thead>
              <tbody>
                {deptBreakdown.map(([dept, stats]) => (
                  <tr key={dept} className="border-t border-gray-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">{dept}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{stats.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{stats.qty.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-red-600">${stats.value.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <SectionCard pad="md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input placeholder="Search item, reference, or person…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]" />
          </div>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]">
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </SectionCard>

      {/* Consumption History Table */}
      <InventoryTable
        rows={filteredRecords}
        rowKey={(r, i) => r.id || `${r.item_id}-${r.transaction_date}-${i}`}
        loading={loading}
        loadingMessage="Loading consumption records…"
        error={error}
        onRetry={load}
        emptyMessage={records.length === 0 ? 'No consumption recorded yet. Click "Record Consumption" to add.' : 'No records match the filters.'}
        columns={[
          {
            key: 'item',
            header: 'Item',
            widthClass: 'md:w-56 shrink-0',
            render: (r) => (
              <IdentityCell
                icon={<Package size={16} />}
                soft={statusTone.neutral.soft}
                text={statusTone.neutral.text}
                name={r.item?.item_name || r.item_id}
                code={r.item?.item_code || ''}
              />
            ),
          },
          {
            key: 'dept',
            header: 'Department',
            widthClass: 'md:w-36 shrink-0',
            render: (r) => (
              <Badge tone="info">{r.store?.department || '—'}</Badge>
            ),
          },
          {
            key: 'store',
            header: 'Store',
            widthClass: 'md:w-32 shrink-0',
            render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.store?.store_name || '—'}</span>,
          },
          {
            key: 'qty',
            header: 'Qty Out',
            widthClass: 'md:w-24 shrink-0',
            align: 'right',
            render: (r) => <span className="text-sm font-bold tabular-nums text-red-600">-{Number(r.quantity_out || 0).toFixed(1)}</span>,
          },
          {
            key: 'value',
            header: 'Value',
            widthClass: 'md:w-28 shrink-0',
            align: 'right',
            render: (r) => <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">${Number(r.value || 0).toFixed(2)}</span>,
          },
          {
            key: 'ref',
            header: 'Reference',
            widthClass: 'md:w-36 shrink-0',
            render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.reference || '—'}</span>,
          },
          {
            key: 'by',
            header: 'By',
            widthClass: 'md:w-28 shrink-0',
            render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.performed_by || '—'}</span>,
          },
          {
            key: 'date',
            header: 'Date',
            widthClass: 'md:w-32 shrink-0',
            render: (r) => <span className="text-sm text-slate-500 dark:text-slate-400">{r.transaction_date?.slice(0, 16).replace('T', ' ') || '—'}</span>,
          },
        ]}
      />

      {/* Record Consumption Modal */}
      <ModalSystem isOpen={showForm} onClose={() => setShowForm(false)} variant="form" size="lg"
        title="Record Consumption"
        subtitle="Deduct inventory items from a department store"
        confirmLabel="Submit Consumption" onConfirm={submitConsumption} loading={submitting} confirmColor="emerald">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Department">
              <select className={inputClass} value={formDept} onChange={e => handleFormDeptChange(e.target.value)}>
                {DEPARTMENTS.filter(d => d !== 'All').map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Consumed By">
              <input className={inputClass} value={formConsumedBy} onChange={e => setFormConsumedBy(e.target.value)} placeholder="Your name" />
            </Field>
            <Field label="Reference Number">
              <input className={inputClass} value={formReferenceNumber} onChange={e => setFormReferenceNumber(e.target.value)} placeholder="e.g. SPA-001, EVT-002" />
            </Field>
            <Field label="Notes">
              <input className={inputClass} value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Optional notes" />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items to Consume</span>
              <button onClick={addLine} className={button.ghost + ' text-xs'}><Plus className="w-3 h-3" /> Add Item</button>
            </div>
            {deptStock.length === 0 && (
              <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                No stock found for {formDept}. Ensure the department has a store with stock balances.
              </p>
            )}
            <div className="space-y-2">
              {formLines.map((line, idx) => {
                const stockItem = deptStock.find(s => s.item_id === line.itemId);
                const available = stockItem ? Number(stockItem.on_hand) : 0;
                const insufficient = line.quantity > available;
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <select className={inputClass + ' flex-1'} value={line.itemId} onChange={e => updateLine(idx, 'itemId', e.target.value)}>
                      <option value="">Select item…</option>
                      {deptStock.map(s => (
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

export default ConsumptionModule;
