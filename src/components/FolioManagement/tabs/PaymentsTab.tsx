/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PaymentsTab — payment ledger (spec §15).
 */
import React, { useState, useMemo } from 'react';
import { Plus, RotateCcw, Printer, XCircle } from 'lucide-react';
import type { FolioV2, FolioTransactionV2 } from '../../../services/folioService';
import { CurrencyAmount, StatusBadge, EmptyState, LoadingState } from '../shared/primitives';

export function PaymentsTab({
  folio,
  transactions,
  loading,
  onAddPayment,
  onVoidPayment,
}: {
  folio: FolioV2;
  transactions: FolioTransactionV2[];
  loading: boolean;
  onAddPayment: () => void;
  onVoidPayment: (paymentId: string) => void;
}) {
  const payments = useMemo(
    () => transactions.filter((t) => t.transactionType === 'payment' || t.transactionType === 'refund'),
    [transactions]
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Payments</h3>
        <button
          onClick={onAddPayment}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90"
        >
          <Plus size={13} /> Add Payment
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading payments…" />
      ) : payments.length === 0 ? (
        <EmptyState title="No payments" description="No payments have been posted to this folio." />
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <th className="py-2 px-3 font-semibold">Payment #</th>
                <th className="py-2 px-3 font-semibold">Date</th>
                <th className="py-2 px-3 font-semibold">Method</th>
                <th className="py-2 px-3 font-semibold">Reference</th>
                <th className="py-2 px-3 font-semibold text-right">Amount</th>
                <th className="py-2 px-3 font-semibold">Status</th>
                <th className="py-2 px-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {payments.map((p) => (
                <tr key={p.transactionId} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${p.isVoided ? 'opacity-50' : ''}`}>
                  <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{p.transactionNumber}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{p.transactionDate}</td>
                  <td className="py-2 px-3 text-gray-700 dark:text-gray-200">{p.category}</td>
                  <td className="py-2 px-3 font-mono text-gray-500 dark:text-gray-400">{p.reference || '—'}</td>
                  <td className="py-2 px-3 text-right font-semibold text-gray-900 dark:text-white">
                    <CurrencyAmount amount={p.credit} currency={folio.currency} />
                  </td>
                  <td className="py-2 px-3">
                    {p.isVoided ? <StatusBadge status="Void" kind="transaction" size="xs" /> : <StatusBadge status="Posted" kind="transaction" size="xs" />}
                  </td>
                  <td className="py-2 px-3">
                    {!p.isVoided && (
                      <button
                        onClick={() => onVoidPayment(p.transactionId)}
                        title="Void"
                        className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
