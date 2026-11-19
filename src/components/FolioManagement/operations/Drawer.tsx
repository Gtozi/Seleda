/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Drawer — right-side drawer shell (spec §14, §16, §17, §18).
 */
import React from 'react';
import { X } from 'lucide-react';

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  if (!open) return null;
  const w = width === 'lg' ? 'max-w-2xl' : width === 'sm' ? 'max-w-md' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative ${w} w-full bg-white dark:bg-slate-800 shadow-xl flex flex-col animate-[slide-in-right_0.2s_ease-out]`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block mb-3">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]';

export const selectCls = inputCls;

export function DrawerFooter({
  onCancel,
  onConfirm,
  confirmLabel,
  cancelLabel = 'Cancel',
  loading,
  disabled,
  destructive,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        onClick={onCancel}
        className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
      >
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        disabled={loading || disabled}
        className={`px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 ${
          destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--color-accent-operations)] hover:opacity-90'
        }`}
      >
        {loading ? 'Processing…' : confirmLabel}
      </button>
    </div>
  );
}
