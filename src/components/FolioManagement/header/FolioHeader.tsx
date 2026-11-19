/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FolioHeader — title, status, metadata, and action buttons (spec §9).
 */
import React from 'react';
import {
  Plus, CreditCard, ArrowRightLeft, Split, FileText, Printer,
  XCircle, RotateCcw, Edit, MoreHorizontal, Ban,
} from 'lucide-react';
import type { FolioV2 } from '../../../services/folioService';
import { StatusBadge, FolioTypeBadge, CurrencyAmount } from '../shared/primitives';

export interface FolioAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function FolioHeader({
  folio,
  onAction,
}: {
  folio: FolioV2 | null;
  onAction: (action: string) => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  if (!folio) {
    return (
      <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a folio from the hierarchy.</p>
      </div>
    );
  }

  const folioNumber = folio.folio_number || folio.id.slice(0, 8).toUpperCase();
  const accountName = folio.ownerName || folio.reservations?.guest_name || 'Guest';
  const created = folio.opened_at
    ? new Date(folio.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  const primaryActions: FolioAction[] = [
    { id: 'add-charge', label: 'Add Charge', icon: Plus, onClick: () => onAction('add-charge') },
    { id: 'add-payment', label: 'Add Payment', icon: CreditCard, onClick: () => onAction('add-payment') },
    { id: 'transfer', label: 'Transfer', icon: ArrowRightLeft, onClick: () => onAction('transfer') },
    { id: 'split', label: 'Split', icon: Split, onClick: () => onAction('split') },
    { id: 'create-invoice', label: 'Invoice', icon: FileText, onClick: () => onAction('create-invoice') },
  ];

  const isOpen = folio.status === 'Open' || folio.status === 'Active' || folio.status === 'Reopened';

  const menuActions: FolioAction[] = [
    { id: 'edit', label: 'Edit Folio', icon: Edit, onClick: () => onAction('edit') },
    { id: 'print', label: 'Print', icon: Printer, onClick: () => onAction('print') },
    ...(folio.status === 'Closed'
      ? [{ id: 'reopen', label: 'Reopen', icon: RotateCcw, onClick: () => onAction('reopen') }]
      : []),
    ...(isOpen
      ? [{ id: 'close', label: 'Close', icon: XCircle, onClick: () => onAction('close') }]
      : []),
    { id: 'void', label: 'Void', icon: Ban, destructive: true, onClick: () => onAction('void') },
  ];

  return (
    <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {folio.ownerName || (folio.folio_type === 'Guest' && folio.reservations?.guest_name) || `${folio.folio_type} Folio`}
            </h1>
            <span className="font-mono text-sm text-gray-500 dark:text-gray-400">#{folioNumber}</span>
            <StatusBadge status={folio.status} />
            <FolioTypeBadge folioType={folio.folio_type} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
            <span><strong className="text-gray-700 dark:text-gray-200">Account:</strong> {accountName}</span>
            <span><strong className="text-gray-700 dark:text-gray-200">Currency:</strong> {folio.currency}</span>
            <span><strong className="text-gray-700 dark:text-gray-200">Created:</strong> {created}</span>
            <CurrencyAmount
              amount={folio.balance}
              currency={folio.currency}
              className="font-semibold text-gray-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {primaryActions.map((a) => (
            <button
              key={a.id}
              onClick={a.onClick}
              disabled={!isOpen && a.id !== 'create-invoice'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <a.icon size={13} />
              {a.label}
            </button>
          ))}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg py-1">
                  {menuActions.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { setMenuOpen(false); a.onClick(); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 ${
                        a.destructive ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'
                      }`}
                    >
                      <a.icon size={13} />
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
