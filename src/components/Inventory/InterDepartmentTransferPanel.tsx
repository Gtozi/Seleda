/**
 * InterDepartmentTransferPanel — Shared component for inter-department
 * stock transfers routed through Central Warehouse (two-leg).
 *
 * Embeddable in any department inventory module (Engineering, Housekeeping, F&B).
 * The source department is fixed; the user picks a destination department.
 * The backend auto-creates two legs: Dept A → Central → Dept B.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowRightLeft, Plus, Trash2, Loader2, Truck, Package, AlertTriangle,
  ArrowRight, CheckCircle2, Clock, X,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import {
  fetchStores, fetchStock, fetchTransfers, createTransfer, updateTransfer,
  type UinvStore, type UinvStockBalance, type UinvTransfer,
} from '../../services/inventoryService';
import {
  MAIN_STORE_ID, DEPARTMENT_STORE_MAP, ALL_DEPARTMENTS,
} from '../../config/storeConstants';

interface InterDepartmentTransferPanelProps {
  /** The department this panel is embedded in (source department). */
  sourceDepartment: string;
}

interface TransferLineDraft {
  itemId: string;
  itemName: string;
  unit: string;
  unitCost: number;
  quantity: number;
}

const inputClass = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all';
const selectClass = inputClass;
const buttonPrimary = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50';
const buttonSecondary = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50';
const buttonGhost = 'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors';

const InterDepartmentTransferPanel: React.FC<InterDepartmentTransferPanelProps> = ({ sourceDepartment }) => {
  const { currentPropertyId, addNotification } = useERP();

  // Data
  const [stores, setStores] = useState<UinvStore[]>([]);
  const [sourceStock, setSourceStock] = useState<UinvStockBalance[]>([]);
  const [transfers, setTransfers] = useState<UinvTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [destDepartment, setDestDepartment] = useState<string>('');
  const [destStoreId, setDestStoreId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [lines, setLines] = useState<TransferLineDraft[]>([]);

  // Source store IDs for this department
  const sourceStoreIds = DEPARTMENT_STORE_MAP[sourceDepartment] || [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [storesData, stockData, transfersData] = await Promise.all([
        fetchStores({ propertyId: currentPropertyId || undefined, active: 'true' }).catch(() => []),
        fetchStock({ propertyId: currentPropertyId || undefined, department: sourceDepartment }).catch(() => []),
        fetchTransfers({ propertyId: currentPropertyId || undefined }).catch(() => []),
      ]);
      setStores(storesData as UinvStore[]);
      setSourceStock(stockData as UinvStockBalance[]);
      // Filter transfers that involve this department's stores (either as source or dest)
      const relevant = (transfersData as UinvTransfer[]).filter(t =>
        sourceStoreIds.includes(t.from_store_id || '') ||
        sourceStoreIds.includes(t.to_store_id || '')
      );
      setTransfers(relevant);
    } catch (e: any) {
      setError(e?.message || 'Failed to load transfer data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId, sourceDepartment, sourceStoreIds.join(',')]);

  useEffect(() => { load(); }, [load]);

  // Destination department stores
  const destStores = stores.filter(s => {
    const destIds = DEPARTMENT_STORE_MAP[destDepartment] || [];
    return destIds.includes(s.id);
  });

  // Available items (from source department stock)
  const availableItems = sourceStock.filter(s => Number(s.on_hand) > 0);

  const addLine = () => {
    const first = availableItems[0];
    setLines(prev => [...prev, {
      itemId: first?.item_id || '',
      itemName: first?.item?.item_name || '',
      unit: first?.item?.unit_of_measure || 'pcs',
      unitCost: Number(first?.unit_cost || 0),
      quantity: 1,
    }]);
  };

  const updateLine = (idx: number, field: string, value: any) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const onItemChange = (idx: number, itemId: string) => {
    const bal = sourceStock.find(s => s.item_id === itemId);
    updateLine(idx, 'itemId', itemId);
    updateLine(idx, 'itemName', bal?.item?.item_name || '');
    updateLine(idx, 'unit', bal?.item?.unit_of_measure || 'pcs');
    updateLine(idx, 'unitCost', Number(bal?.unit_cost || 0));
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setDestDepartment('');
    setDestStoreId('');
    setReason('');
    setNotes('');
    setPriority('Normal');
    setLines([]);
    setShowForm(false);
  };

  const submitTransfer = async () => {
    if (!destDepartment) {
      addNotification('Select a destination department.', 'warning', sourceDepartment);
      return;
    }
    if (!destStoreId) {
      addNotification('Select a destination store.', 'warning', sourceDepartment);
      return;
    }
    if (lines.length === 0) {
      addNotification('At least one line item is required.', 'warning', sourceDepartment);
      return;
    }
    if (lines.some(l => !l.itemId || l.quantity <= 0)) {
      addNotification('All lines must have an item and positive quantity.', 'warning', sourceDepartment);
      return;
    }

    // Determine source store: use the first source store that has the items
    const sourceStoreId = sourceStoreIds[0];
    if (!sourceStoreId) {
      addNotification(`No store configured for ${sourceDepartment}.`, 'error', sourceDepartment);
      return;
    }

    setSubmitting(true);
    try {
      const transferValue = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
      const created = await createTransfer({
        property_id: currentPropertyId,
        from_store_id: sourceStoreId,
        to_store_id: destStoreId,
        priority,
        reason: reason || `Inter-department transfer: ${sourceDepartment} → ${destDepartment}`,
        notes: notes || undefined,
        transfer_value: transferValue,
        lines: lines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unit: l.unit,
          unitCost: l.unitCost,
          quantity: Number(l.quantity),
        })),
      });
      const twoLeg = (created as any)?._twoLeg;
      if (twoLeg) {
        const leg2 = (created as any)?._leg2;
        addNotification(
          `Two-leg transfer created: ${created.transfer_number} (${sourceDepartment}→Central) + ${leg2?.transfer_number} (Central→${destDepartment}). Leg 2 auto-completes when Leg 1 is received.`,
          'success', sourceDepartment,
        );
      } else {
        addNotification(`Transfer ${created.transfer_number} created.`, 'success', sourceDepartment);
      }
      resetForm();
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to create transfer', 'error', sourceDepartment);
    } finally {
      setSubmitting(false);
    }
  };

  const advanceTransfer = async (t: UinvTransfer, nextStatus: string) => {
    try {
      await updateTransfer(t.id, { status: nextStatus });
      addNotification(`${t.transfer_number} → ${nextStatus}`, 'success', sourceDepartment);
      await load();
    } catch (e: any) {
      addNotification(e?.message || 'Failed to update transfer', 'error', sourceDepartment);
    }
  };

  const storeName = (id: string | null) => stores.find(s => s.id === id)?.store_name || id || '—';
  const isTwoLeg = (t: UinvTransfer) =>
    (t as any).leg === 2 || ((t as any).via_store_id && t.from_store_id !== MAIN_STORE_ID && t.to_store_id !== MAIN_STORE_ID);

  const statusBadge = (status: string) => {
    const tone = status === 'Received' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      : status === 'Dispatched' || status === 'In Transit' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
      : status === 'Pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tone}`}>{status}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4" /> Inter-Department Transfers
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Transfer stock from {sourceDepartment} to another department. All inter-department transfers route through Central Warehouse (two-leg).
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={buttonSecondary}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} Refresh
          </button>
          <button onClick={() => { setShowForm(true); setLines([]); setDestDepartment(''); setDestStoreId(''); }} className={buttonPrimary}>
            <Plus className="w-4 h-4" /> New Inter-Dept Transfer
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700">
          <div className="text-xs text-slate-500">Total Transfers</div>
          <div className="text-lg font-bold text-slate-700 dark:text-slate-200">{transfers.length}</div>
        </div>
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div className="text-xs text-amber-600">Pending</div>
          <div className="text-lg font-bold text-amber-700">{transfers.filter(t => t.status === 'Pending').length}</div>
        </div>
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="text-xs text-blue-600">In Transit</div>
          <div className="text-lg font-bold text-blue-700">{transfers.filter(t => t.status === 'Dispatched' || t.status === 'In Transit').length}</div>
        </div>
        <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <div className="text-xs text-green-600">Received</div>
          <div className="text-lg font-bold text-green-700">{transfers.filter(t => t.status === 'Received').length}</div>
        </div>
      </div>

      {/* Transfer list */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Transfer #</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium text-right">Value</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline-block" /></td></tr>
              )}
              {!loading && transfers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No inter-department transfers yet. Click "New Inter-Dept Transfer" to create one.</td></tr>
              )}
              {!loading && transfers.map(t => {
                const twoLeg = isTwoLeg(t);
                const leg = (t as any).leg || 1;
                const isSource = sourceStoreIds.includes(t.from_store_id || '');
                return (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{t.transfer_number}</div>
                      <div className="text-[10px] text-slate-400">{t.created_at?.slice(0, 10)}</div>
                      {twoLeg && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          LEG {leg} · VIA CENTRAL
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-700 dark:text-slate-200">{storeName(t.from_store_id)}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1"><ArrowRight className="w-3 h-3" />{storeName(t.to_store_id)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        {(t.lines || []).map((l: any) => l.itemName).filter(Boolean).join(', ').slice(0, 50) || '—'}
                      </div>
                      <div className="text-[10px] text-slate-400">{t.lines?.length || 0} item(s)</div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-700 dark:text-slate-200">
                      ${Number(t.transfer_value || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">{statusBadge(t.status)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {isSource && t.status === 'Pending' && (
                          <button onClick={() => advanceTransfer(t, 'Dispatched')} title="Dispatch"
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600">
                            <Truck className="w-4 h-4" />
                          </button>
                        )}
                        {t.status === 'Dispatched' && (
                          <button onClick={() => advanceTransfer(t, 'Received')} title="Mark Received"
                            className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Transfer Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">New Inter-Department Transfer</h3>
              <button onClick={resetForm} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Two-leg notice */}
              <div className="px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                <ArrowRightLeft className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <strong>Two-leg transfer via Central:</strong> This transfer will be automatically routed through Central Warehouse.
                  <div className="mt-1 text-xs">
                    Leg 1: {sourceDepartment} → Central Warehouse<br/>
                    Leg 2: Central Warehouse → {destDepartment || '[Select dept]'} (auto-completed when Leg 1 is received)
                  </div>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">From Department</label>
                  <input className={inputClass} value={sourceDepartment} disabled />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">To Department *</label>
                  <select className={selectClass} value={destDepartment} onChange={e => {
                    setDestDepartment(e.target.value);
                    setDestStoreId('');
                  }}>
                    <option value="">Select department…</option>
                    {ALL_DEPARTMENTS.filter(d => d !== sourceDepartment).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Destination Store *</label>
                  <select className={selectClass} value={destStoreId} onChange={e => setDestStoreId(e.target.value)} disabled={!destDepartment}>
                    <option value="">Select store…</option>
                    {destStores.map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Priority</label>
                  <select className={selectClass} value={priority} onChange={e => setPriority(e.target.value)}>
                    {['Low', 'Normal', 'High', 'Urgent'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Reason</label>
                  <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional reason…" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes</label>
                  <input className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-500 uppercase">Line Items</span>
                  <button onClick={addLine} className={buttonGhost}><Plus className="w-3 h-3" /> Add item</button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, idx) => {
                    const bal = sourceStock.find(s => s.item_id === line.itemId);
                    const maxQty = Number(bal?.on_hand || 0);
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <div className="col-span-12 md:col-span-5">
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Item</span>
                          <select className={selectClass} value={line.itemId} onChange={e => onItemChange(idx, e.target.value)}>
                            <option value="">Select item…</option>
                            {availableItems.map(s => (
                              <option key={s.item_id} value={s.item_id}>
                                {s.item?.item_name} (On hand: {s.on_hand} {s.item?.unit_of_measure || ''})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Qty</span>
                          <input type="number" min={1} max={maxQty} className={inputClass} value={line.quantity}
                            onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} />
                        </div>
                        <div className="col-span-2 md:col-span-1">
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Unit</span>
                          <input className={inputClass} value={line.unit} onChange={e => updateLine(idx, 'unit', e.target.value)} />
                        </div>
                        <div className="col-span-2 md:col-span-2">
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Unit Cost</span>
                          <input type="number" min={0} step="0.01" className={inputClass} value={line.unitCost}
                            onChange={e => updateLine(idx, 'unitCost', Number(e.target.value))} />
                        </div>
                        <div className="col-span-2 md:col-span-1">
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Total</span>
                          <div className="text-sm font-semibold py-2">{(Number(line.quantity) * Number(line.unitCost)).toFixed(2)}</div>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button onClick={() => removeLine(idx)} className="p-2 text-red-500 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        {maxQty > 0 && line.quantity > maxQty && (
                          <div className="col-span-12 text-xs text-red-500 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Warning: quantity exceeds available stock ({maxQty} {line.unit})
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {lines.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">No line items. Click "Add item" to add one.</p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-slate-700">
                <div className="text-sm text-slate-500">
                  {lines.length} items · Est. Total: <span className="font-bold text-slate-700 dark:text-slate-300">
                    ${lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={resetForm} className={buttonSecondary}>Cancel</button>
                  <button onClick={submitTransfer} disabled={submitting} className={buttonPrimary}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Create Transfer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InterDepartmentTransferPanel;
