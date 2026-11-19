/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared primitives for the Folio Management UI (docs/Folio & billing.md §7).
 * CurrencyAmount, StatusBadge, EmptyState, LoadingState, ConfirmationDialog.
 */
import React from 'react';
import { Loader2, Inbox, AlertCircle } from 'lucide-react';
import { statusTone, type StatusTone } from '../../FrontOffice/brandTheme';

// ── CurrencyAmount ─────────────────────────────────────────────
export function CurrencyAmount({
  amount,
  currency = 'USD',
  className = '',
  signed = false,
}: {
  amount: number;
  currency?: string;
  className?: string;
  signed?: boolean;
}) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
  const sign = signed ? (amount >= 0 ? '+' : '-') : amount < 0 ? '-' : '';
  return (
    <span className={className}>
      {sign}
      {formatted}
    </span>
  );
}

// ── StatusBadge ────────────────────────────────────────────────
const FOLIO_STATUS_TONE: Record<string, StatusTone> = {
  Open: 'info',
  Active: 'success',
  Pending: 'warning',
  Settled: 'success',
  Closed: 'neutral',
  Reopened: 'warning',
  Suspended: 'danger',
  Void: 'danger',
};

const INVOICE_STATUS_TONE: Record<string, StatusTone> = {
  Draft: 'neutral',
  Issued: 'info',
  'Partially Paid': 'warning',
  Paid: 'success',
  Overdue: 'danger',
  Void: 'danger',
};

export function StatusBadge({
  status,
  kind = 'folio',
  size = 'sm',
}: {
  status: string;
  kind?: 'folio' | 'invoice' | 'transaction';
  size?: 'sm' | 'xs';
}) {
  const map = kind === 'invoice' ? INVOICE_STATUS_TONE : FOLIO_STATUS_TONE;
  const tone = map[status] || 'neutral';
  const classes = statusTone[tone];
  const sizeCls = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${classes.soft} ${sizeCls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${classes.dot}`} />
      {status}
    </span>
  );
}

// ── FolioTypeBadge ─────────────────────────────────────────────
const FOLIO_TYPE_ICON: Record<string, string> = {
  Guest: '👤',
  Group: '👥',
  Company: '🏢',
  Master: '⭐',
};

export function FolioTypeBadge({ folioType }: { folioType: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
      <span>{FOLIO_TYPE_ICON[folioType] || '📄'}</span>
      {folioType} Folio
    </span>
  );
}

// ── EmptyState ─────────────────────────────────────────────────
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center mb-3">
        <Icon size={24} className="text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── LoadingState ───────────────────────────────────────────────
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="animate-spin text-[var(--color-accent-operations)]" size={24} />
      <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
}

// ── ErrorState ─────────────────────────────────────────────────
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
        <AlertCircle size={24} className="text-red-600 dark:text-red-400" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Something went wrong</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent-operations)] text-white hover:opacity-90"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ── ConfirmationDialog ─────────────────────────────────────────
export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-semibold rounded-lg text-white ${
              destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[var(--color-accent-operations)] hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast (minimal) ────────────────────────────────────────────
export function Toast({
  message,
  tone = 'info',
  onClose,
}: {
  message: string;
  tone?: StatusTone;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  const classes = statusTone[tone];
  return (
    <div className="fixed bottom-4 right-4 z-[70] animate-fade-in">
      <div className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${classes.badge}`}>
        {message}
      </div>
    </div>
  );
}
