/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TransactionsTab — unified ledger with filters (spec §13).
 */
import React, { useState, useMemo } from 'react';
import { Download, Plus, RotateCcw, Eye, Filter, ArrowUp, ArrowDown, X, Pencil, Ban, ChevronRight, ChevronDown } from 'lucide-react';
import type { FolioV2, FolioTransactionV2 } from '../../../services/folioService';
import { CurrencyAmount, StatusBadge, EmptyState, LoadingState } from '../shared/primitives';

export interface LinkedFolio {
  id: string;
  folioType: string;
  label: string;
  direction: 'parent' | 'child';
}

// ── Grouped transaction type ───────────────────────────────────
interface GroupedTransaction {
  isGroup: true;
  groupKey: string;
  description: string;
  category: string;
  department: string;
  reference: string;
  quantity: number;
  totalDebit: number;
  totalCredit: number;
  isVoided: boolean;
  items: FolioTransactionV2[];
}

type DisplayRow = FolioTransactionV2 | GroupedTransaction;

function isGroup(row: DisplayRow): row is GroupedTransaction {
  return (row as GroupedTransaction).isGroup === true;
}

export function TransactionsTab({
  folio,
  transactions,
  loading,
  onAddCharge,
  onReverse,
  onEdit,
  onVoid,
  selectedLineIds,
  onSelectLine,
  onSelectAll,
  linkedFolios,
  onQuickMove,
}: {
  folio: FolioV2;
  transactions: FolioTransactionV2[];
  loading: boolean;
  onAddCharge: () => void;
  onReverse: (lineId: string, description: string) => void;
  onEdit: (lineId: string, currentDescription: string, currentAmount: number, currentLineType: string) => void;
  onVoid: (lineId: string, description: string) => void;
  selectedLineIds: Set<string>;
  onSelectLine: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  linkedFolios: LinkedFolio[];
  onQuickMove: (destFolioId: string, destLabel: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupByItem, setGroupByItem] = useState(true);

  const departments = useMemo(() => {
    const set = new Set(transactions.map((t) => t.department).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (typeFilter !== 'all' && t.transactionType !== typeFilter) return false;
      if (deptFilter !== 'all' && t.department !== deptFilter) return false;
      if (statusFilter === 'posted' && t.isVoided) return false;
      if (statusFilter === 'voided' && !t.isVoided) return false;
      return true;
    });
  }, [transactions, typeFilter, deptFilter, statusFilter]);

  // Group charges by description + category (same item)
  // Payments, refunds, and voided charges are NOT grouped
  const displayRows = useMemo((): DisplayRow[] => {
    if (!groupByItem) return filtered;

    const charges = filtered.filter((t) => t.transactionType === 'charge' && !t.isVoided);
    const nonCharges = filtered.filter((t) => !(t.transactionType === 'charge' && !t.isVoided));

    // Group charges by description + category
    const groups = new Map<string, FolioTransactionV2[]>();
    for (const c of charges) {
      const key = `${c.description}||${c.category}`;
      const arr = groups.get(key) || [];
      arr.push(c);
      groups.set(key, arr);
    }

    const groupedRows: DisplayRow[] = [];
    for (const [key, items] of groups) {
      if (items.length > 1) {
        const first = items[0];
        groupedRows.push({
          isGroup: true,
          groupKey: key,
          description: first.description,
          category: first.category,
          department: first.department,
          reference: first.reference,
          quantity: items.length,
          totalDebit: items.reduce((sum, i) => sum + (i.debit || 0), 0),
          totalCredit: items.reduce((sum, i) => sum + (i.credit || 0), 0),
          isVoided: false,
          items,
        });
      } else {
        groupedRows.push(items[0]);
      }
    }

    // Sort grouped charges by date, then mix with non-charges by date
    const all = [...groupedRows, ...nonCharges];
    all.sort((a, b) => {
      const dateA = isGroup(a) ? a.items[0].transactionDate : a.transactionDate;
      const dateB = isGroup(b) ? b.items[0].transactionDate : b.transactionDate;
      return dateA.localeCompare(dateB);
    });

    return all;
  }, [filtered, groupByItem]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const exportCsv = () => {
    const rows = [
      ['Date', 'Trx #', 'Type', 'Description', 'Reference', 'Department', 'Debit', 'Credit', 'Balance', 'Status'],
      ...filtered.map((t) => [
        t.transactionDate, t.transactionNumber, t.transactionType, t.description,
        t.reference || '', t.department, t.debit, t.credit, t.runningBalance,
        t.isVoided ? 'Voided' : 'Posted',
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `folio-${folio.id.slice(0, 8)}-transactions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Selectable charge IDs (non-voided charges only, from all filtered transactions)
  const selectableIds = useMemo(
    () => filtered.filter((t) => t.transactionType === 'charge' && !t.isVoided).map((t) => t.transactionId),
    [filtered]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedLineIds.has(id));

  // Select all items in a group
  const selectGroup = (group: GroupedTransaction) => {
    const ids = group.items.map((i) => i.transactionId);
    const allInGroup = ids.every((id) => selectedLineIds.has(id));
    if (allInGroup) {
      // Deselect all in group
      const next = new Set(selectedLineIds);
      ids.forEach((id) => next.delete(id));
      onSelectAll(Array.from(next));
    } else {
      // Select all in group
      const next = new Set(selectedLineIds);
      ids.forEach((id) => next.add(id));
      onSelectAll(Array.from(next));
    }
  };

  const isGroupSelected = (group: GroupedTransaction) => {
    return group.items.every((i) => selectedLineIds.has(i.transactionId));
  };

  return (
    <div className="p-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            <Filter size={13} /> Filters
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            <Download size={13} /> Export
          </button>
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={groupByItem}
              onChange={(e) => setGroupByItem(e.target.checked)}
              className="rounded"
            />
            Group items
          </label>
        </div>
        <button
          onClick={onAddCharge}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90"
        >
          <Plus size={13} /> Post Charge
        </button>
      </div>

      {showFilters && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg flex-wrap">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Type:
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="ml-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800">
              <option value="all">All</option>
              <option value="charge">Charge</option>
              <option value="payment">Payment</option>
              <option value="refund">Refund</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Department:
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="ml-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800">
              {departments.map((d) => <option key={d} value={d}>{d === 'all' ? 'All' : d}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Status:
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="ml-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800">
              <option value="all">All</option>
              <option value="posted">Posted</option>
              <option value="voided">Voided</option>
            </select>
          </label>
        </div>
      )}

      {loading ? (
        <LoadingState label="Loading transactions…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No transactions" description="No transactions match the current filters." />
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <th className="py-2 px-3 font-semibold w-8">
                  {selectableIds.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => onSelectAll(allSelected ? [] : selectableIds)}
                      className="rounded"
                    />
                  )}
                </th>
                <th className="py-2 px-3 font-semibold">Date</th>
                <th className="py-2 px-3 font-semibold">Trx #</th>
                <th className="py-2 px-3 font-semibold">Type</th>
                <th className="py-2 px-3 font-semibold">Description</th>
                <th className="py-2 px-3 font-semibold text-center">Qty</th>
                <th className="py-2 px-3 font-semibold">Reference</th>
                <th className="py-2 px-3 font-semibold">Department</th>
                <th className="py-2 px-3 font-semibold text-right">Debit</th>
                <th className="py-2 px-3 font-semibold text-right">Credit</th>
                <th className="py-2 px-3 font-semibold text-right">Balance</th>
                <th className="py-2 px-3 font-semibold">Status</th>
                <th className="py-2 px-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {displayRows.map((row) => {
                if (isGroup(row)) {
                  const expanded = expandedGroups.has(row.groupKey);
                  return (
                    <React.Fragment key={row.groupKey}>
                      {/* Grouped row */}
                      <tr className="hover:bg-blue-50/50 dark:hover:bg-blue-900/10 bg-blue-50/30 dark:bg-blue-900/5">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={isGroupSelected(row)}
                            onChange={() => selectGroup(row)}
                            className="rounded"
                          />
                        </td>
                        <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                          {row.items[0].transactionDate}
                        </td>
                        <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">
                          {row.items.length} items
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">charge</span>
                        </td>
                        <td className="py-2 px-3 text-gray-700 dark:text-gray-200 max-w-xs">
                          <button
                            onClick={() => toggleGroup(row.groupKey)}
                            className="inline-flex items-center gap-1 font-semibold hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {row.description}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-center font-bold text-blue-600 dark:text-blue-400">{row.quantity}</td>
                        <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{row.reference || '—'}</td>
                        <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{row.department}</td>
                        <td className="py-2 px-3 text-right font-bold text-gray-900 dark:text-white">
                          <CurrencyAmount amount={row.totalDebit} currency={folio.currency} />
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                          {row.totalCredit !== 0 ? <CurrencyAmount amount={row.totalCredit} currency={folio.currency} /> : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-gray-400">—</td>
                        <td className="py-2 px-3">
                          <StatusBadge status="Posted" kind="transaction" size="xs" />
                        </td>
                        <td className="py-2 px-3">
                          <span className="text-[10px] text-gray-400">expand to edit</span>
                        </td>
                      </tr>
                      {/* Expanded individual rows */}
                      {expanded && row.items.map((t) => (
                        <tr
                          key={t.transactionId}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 bg-slate-50/50 dark:bg-slate-900/20 border-l-2 border-blue-200 dark:border-blue-800`}
                        >
                          <td className="py-2 px-3">
                            <input
                              type="checkbox"
                              checked={selectedLineIds.has(t.transactionId)}
                              onChange={() => onSelectLine(t.transactionId)}
                              className="rounded"
                            />
                          </td>
                          <td className="py-2 px-3 text-gray-600 dark:text-gray-300 pl-6">{t.transactionDate}</td>
                          <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{t.transactionNumber}</td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">charge</span>
                          </td>
                          <td className="py-2 px-3 text-gray-700 dark:text-gray-200 max-w-xs truncate pl-6">↳ {t.description}</td>
                          <td className="py-2 px-3 text-center text-gray-400">1</td>
                          <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{t.reference || '—'}</td>
                          <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{t.department}</td>
                          <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                            {t.debit > 0 ? <CurrencyAmount amount={t.debit} currency={folio.currency} /> : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                            {t.credit !== 0 ? <CurrencyAmount amount={t.credit} currency={folio.currency} /> : '—'}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-gray-900 dark:text-white">
                            <CurrencyAmount amount={t.runningBalance} currency={folio.currency} />
                          </td>
                          <td className="py-2 px-3">
                            <StatusBadge status="Posted" kind="transaction" size="xs" />
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => onEdit(t.transactionId, t.description, t.debit || t.credit, t.transactionType)}
                                title="Edit"
                                className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => onVoid(t.transactionId, t.description)}
                                title="Void"
                                className="p-1 text-gray-400 hover:text-orange-600 dark:hover:text-orange-400"
                              >
                                <Ban size={13} />
                              </button>
                              <button
                                onClick={() => onReverse(t.transactionId, t.description)}
                                title="Reverse"
                                className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                              >
                                <RotateCcw size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                }

                // Single (non-grouped) row
                const t = row;
                return (
                  <tr
                    key={t.transactionId}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${t.isVoided ? 'opacity-50' : ''}`}
                  >
                    <td className="py-2 px-3">
                      {t.transactionType === 'charge' && !t.isVoided && (
                        <input
                          type="checkbox"
                          checked={selectedLineIds.has(t.transactionId)}
                          onChange={() => onSelectLine(t.transactionId)}
                          className="rounded"
                        />
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{t.transactionDate}</td>
                    <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{t.transactionNumber}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        t.transactionType === 'charge' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                        t.transactionType === 'payment' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>{t.transactionType}</span>
                    </td>
                    <td className="py-2 px-3 text-gray-700 dark:text-gray-200 max-w-xs truncate">{t.description}</td>
                    <td className="py-2 px-3 text-center text-gray-400">1</td>
                    <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{t.reference || '—'}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{t.department}</td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                      {t.debit > 0 ? <CurrencyAmount amount={t.debit} currency={folio.currency} /> : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-white">
                      {t.credit !== 0 ? <CurrencyAmount amount={t.credit} currency={folio.currency} /> : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-900 dark:text-white">
                      <CurrencyAmount amount={t.runningBalance} currency={folio.currency} />
                    </td>
                    <td className="py-2 px-3">
                      {t.isVoided ? <StatusBadge status="Void" kind="transaction" size="xs" /> : <StatusBadge status="Posted" kind="transaction" size="xs" />}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-0.5">
                        {t.transactionType === 'charge' && !t.isVoided && (
                          <>
                            <button
                              onClick={() => onEdit(t.transactionId, t.description, t.debit || t.credit, t.transactionType)}
                              title="Edit"
                              className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => onVoid(t.transactionId, t.description)}
                              title="Void"
                              className="p-1 text-gray-400 hover:text-orange-600 dark:hover:text-orange-400"
                            >
                              <Ban size={13} />
                            </button>
                            <button
                              onClick={() => onReverse(t.transactionId, t.description)}
                              title="Reverse"
                              className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <RotateCcw size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedLineIds.size > 0 && (
        <div className="sticky bottom-0 mt-3 p-3 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                {selectedLineIds.size} charge(s) selected
              </span>
              <button
                onClick={() => onSelectAll([])}
                className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X size={11} /> Clear
              </button>
            </div>
            {linkedFolios.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Move to:</span>
                {linkedFolios.map((lf) => (
                  <button
                    key={lf.id}
                    onClick={() => onQuickMove(lf.id, lf.label)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)] hover:bg-[var(--color-accent-operations)]/20 border border-[var(--color-accent-operations)]/30"
                    title={`Move selected charges to ${lf.label} (${lf.folioType} folio)`}
                  >
                    {lf.direction === 'parent' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                    {lf.label}
                    <span className="opacity-60">({lf.folioType})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
