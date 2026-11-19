/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuditTimeline — immutable per-folio activity timeline (spec §20).
 */
import React from 'react';
import { Clock, ArrowRight, RotateCcw, Plus, Minus, FileText, XCircle, Send, Edit } from 'lucide-react';
import type { FolioAuditEntryV2 } from '../../../services/folioService';
import { CurrencyAmount } from './primitives';

const ACTION_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  charge_posted: Plus,
  payment_posted: Plus,
  refund_posted: Minus,
  payment_voided: XCircle,
  reverse: RotateCcw,
  split_out: ArrowRight,
  split_in: ArrowRight,
  transfer_out: ArrowRight,
  transfer_in: ArrowRight,
  close: XCircle,
  reopen: RotateCcw,
  void: XCircle,
  folio_edited: Edit,
  invoice_generated: FileText,
};

const ACTION_LABEL: Record<string, string> = {
  charge_posted: 'Charge posted',
  payment_posted: 'Payment posted',
  refund_posted: 'Refund posted',
  payment_voided: 'Payment voided',
  reverse: 'Charge reversed',
  split_out: 'Split out',
  split_in: 'Received from split',
  transfer_out: 'Transferred out',
  transfer_in: 'Received from transfer',
  close: 'Folio closed',
  reopen: 'Folio reopened',
  void: 'Folio voided',
  folio_edited: 'Folio edited',
  invoice_generated: 'Invoice generated',
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

export function AuditTimeline({ entries }: { entries: FolioAuditEntryV2[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
        No activity recorded yet.
      </div>
    );
  }
  return (
    <div className="relative pl-6">
      {/* vertical line */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-gray-200 dark:bg-slate-700" />
      <ul className="space-y-5">
        {entries.map((e) => {
          const Icon = ACTION_ICON[e.action] || Clock;
          return (
            <li key={e.id} className="relative">
              {/* dot */}
              <div className="absolute -left-[18px] top-0.5 w-4 h-4 rounded-full bg-white dark:bg-slate-800 border-2 border-[var(--color-accent-operations)] flex items-center justify-center">
                <Icon size={9} className="text-[var(--color-accent-operations)]" />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {e.user || 'System'}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {ACTION_LABEL[e.action] || e.action}
                    </span>
                  </div>
                  {e.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{e.description}</p>
                  )}
                  {e.reason && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 italic">
                      Reason: {e.reason}
                    </p>
                  )}
                  {e.sourceFolioId && e.destFolioId && (
                    <p className="text-[11px] font-mono text-gray-500 dark:text-gray-500 mt-0.5">
                      {e.sourceFolioId.slice(0, 8)} → {e.destFolioId.slice(0, 8)}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {e.amount != null && (
                    <CurrencyAmount
                      amount={e.amount}
                      className="text-xs font-semibold text-gray-700 dark:text-gray-300"
                    />
                  )}
                  <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {formatTime(e.timestamp)}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
