/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SummaryTab — folio info + balance breakdown + linked folios (spec §12).
 */
import React from 'react';
import type { FolioV2, FolioSummaryV2 } from '../../../services/folioService';
import { CurrencyAmount, StatusBadge, FolioTypeBadge, EmptyState } from '../shared/primitives';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-white text-right">{value}</span>
    </div>
  );
}

export function SummaryTab({
  folio,
  summary,
  onSelectLinked,
}: {
  folio: FolioV2;
  summary?: FolioSummaryV2;
  onSelectLinked?: (folioId: string) => void;
}) {
  const folioNumber = folio.folio_number || folio.id.slice(0, 8).toUpperCase();
  const accountName = folio.ownerName || folio.reservations?.guest_name || 'Guest';
  const created = folio.opened_at
    ? new Date(folio.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const bd = summary?.balanceBreakdown;
  const linked = summary?.linkedFolios ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Folio Information */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Folio Information</h3>
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            <InfoRow label="Folio Number" value={<span className="font-mono">{folioNumber}</span>} />
            <InfoRow label="Folio Type" value={<FolioTypeBadge folioType={folio.folio_type} />} />
            <InfoRow label="Status" value={<StatusBadge status={folio.status} />} />
            <InfoRow label="Account" value={accountName} />
            <InfoRow label="Currency" value={folio.currency} />
            <InfoRow label="Created" value={created} />
            <InfoRow label="Created By" value={folio.created_by || '—'} />
            <InfoRow label="Description" value={folio.notes || '—'} />
          </div>
        </div>

        {/* Balance Breakdown */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Balance Breakdown</h3>
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            <InfoRow label="Total Charges" value={<CurrencyAmount amount={bd?.totalCharges ?? folio.total_charges} currency={folio.currency} />} />
            <InfoRow label="Total Payments" value={<CurrencyAmount amount={bd?.totalPayments ?? folio.total_payments} currency={folio.currency} />} />
            <InfoRow label="Adjustments" value={<CurrencyAmount amount={bd?.adjustments ?? 0} currency={folio.currency} />} />
            <InfoRow label="Transfers In" value={<CurrencyAmount amount={bd?.transfersIn ?? 0} currency={folio.currency} />} />
            <InfoRow label="Transfers Out" value={<CurrencyAmount amount={bd?.transfersOut ?? 0} currency={folio.currency} />} />
            <div className="flex items-center justify-between py-2 text-sm font-bold">
              <span className="text-gray-900 dark:text-white">Current Balance</span>
              <CurrencyAmount amount={bd?.currentBalance ?? folio.balance} currency={folio.currency} className="text-gray-900 dark:text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Linked Folios */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Linked Folios</h3>
        {linked.length === 0 ? (
          <EmptyState title="No linked folios" description="This folio has no child folios." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 pr-4 font-semibold">Folio</th>
                  <th className="py-2 pr-4 font-semibold">Type</th>
                  <th className="py-2 pr-4 font-semibold text-right">Charges</th>
                  <th className="py-2 pr-4 font-semibold text-right">Payments</th>
                  <th className="py-2 pr-4 font-semibold text-right">Balance</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {linked.map((lf) => (
                  <tr
                    key={lf.id}
                    onClick={() => onSelectLinked?.(lf.id)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
                  >
                    <td className="py-2 pr-4 font-mono text-gray-700 dark:text-gray-200">
                      {lf.folioNumber || lf.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="py-2 pr-4"><FolioTypeBadge folioType={lf.folioType} /></td>
                    <td className="py-2 pr-4 text-right"><CurrencyAmount amount={lf.totalCharges} currency={folio.currency} /></td>
                    <td className="py-2 pr-4 text-right"><CurrencyAmount amount={lf.totalPayments} currency={folio.currency} /></td>
                    <td className="py-2 pr-4 text-right font-semibold"><CurrencyAmount amount={lf.balance} currency={folio.currency} /></td>
                    <td className="py-2 pr-4"><StatusBadge status={lf.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
