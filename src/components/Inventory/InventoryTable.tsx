/**
 * InventoryTable — shared table component matching the F&B InventoryCoordination
 * table UI style. Used across all inventory portal modules for a consistent
 * look and feel.
 *
 * Style characteristics (matches SectionCard + table in FoodBeverage/InventoryCoordination.tsx):
 *   - Container: bg-white dark:bg-slate-800 rounded-2xl border card-shadow overflow-hidden
 *   - HTML <table> with thead/tbody
 *   - Header: bg-slate-50 dark:bg-slate-900/40, text-xs uppercase text-slate-500
 *   - Header cells: px-4 py-3 font-medium
 *   - Rows: hover:bg-slate-50 dark:hover:bg-slate-700/40, px-4 py-3
 *   - Body: divide-y divide-gray-200 dark:divide-slate-700
 *   - Status pills: Badge with statusTone (success/warning/danger/info/neutral)
 *   - Action buttons: p-1 text-slate-400 hover:text-indigo-600, always visible
 */
import React, { useState, type ReactNode } from 'react';
import { Loader2, ServerCrash, ChevronDown, ChevronRight } from 'lucide-react';

export interface InventoryColumn<T> {
  key: string;
  header: string;
  /** Optional width class, e.g. "md:w-72 shrink-0" or "md:w-28 shrink-0" */
  widthClass?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T, index: number) => ReactNode;
}

interface InventoryTableProps<T> {
  columns: InventoryColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  emptyMessage?: string;
  onRetry?: () => void;
  /** Optional card title (renders a SectionCard-style header). */
  title?: string;
  /** Optional card subtitle. */
  subtitle?: string;
  /** Optional footer content (e.g. totals row). Rendered inside a <tfoot>. */
  footer?: ReactNode;
  /** If provided, rows become expandable — clicking the toggle shows this content below the row. */
  renderExpanded?: (row: T, index: number) => ReactNode;
  /** Predicate to show the expand toggle. If omitted, all rows are expandable when renderExpanded is set. */
  canExpand?: (row: T, index: number) => boolean;
}

const alignClass = (align?: 'left' | 'right' | 'center') => {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
};

function InventoryTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  loadingMessage = 'Loading...',
  error,
  emptyMessage = 'No records.',
  onRetry,
  title,
  subtitle,
  footer,
  renderExpanded,
  canExpand,
}: InventoryTableProps<T>) {
  const safeRows = rows || [];
  const safeColumns = columns || [];
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isExpandable = !!renderExpanded;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 card-shadow smooth-transition overflow-hidden">
      {(title || subtitle) && (
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase text-slate-500">
            <tr>
              {isExpandable && (
                <th className="w-8 px-2 py-3 font-medium" />
              )}
              {safeColumns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-3 font-medium ${alignClass(col.align)} ${col.widthClass || ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {loading && (
              <tr>
                <td colSpan={safeColumns.length + (isExpandable ? 1 : 0)} className="px-4 py-8">
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> {loadingMessage}
                  </div>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={safeColumns.length + (isExpandable ? 1 : 0)} className="px-4 py-8">
                  <div className="flex items-center justify-center gap-2 text-sm text-rose-600">
                    <ServerCrash className="w-4 h-4 shrink-0" /> {error}
                    {onRetry && (
                      <button onClick={onRetry} className="ml-2 text-xs font-medium uppercase text-indigo-600 hover:text-indigo-700 transition-colors">
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {!loading && !error && safeRows.length === 0 && (
              <tr>
                <td colSpan={safeColumns.length + (isExpandable ? 1 : 0)} className="px-4 py-8">
                  <div className="text-center text-sm text-slate-500">{emptyMessage}</div>
                </td>
              </tr>
            )}
            {!loading && !error && safeRows.map((row, index) => {
              const key = rowKey(row, index);
              const showToggle = isExpandable && (!canExpand || canExpand(row, index));
              const isExpanded = expandedKeys.has(key);
              return (
                <React.Fragment key={key}>
                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    {isExpandable && (
                      <td className="w-8 px-2 py-3 align-middle">
                        {showToggle && (
                          <button
                            onClick={() => toggleExpand(key)}
                            className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-slate-500" />
                              : <ChevronRight className="w-4 h-4 text-slate-400" />}
                          </button>
                        )}
                      </td>
                    )}
                    {columns.map(col => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${alignClass(col.align)} ${col.widthClass || ''}`}
                      >
                        {col.render(row, index)}
                      </td>
                    ))}
                  </tr>
                  {isExpandable && isExpanded && showToggle && (
                    <tr className="bg-slate-50/70 dark:bg-slate-800/50">
                      <td colSpan={safeColumns.length + 1} className="px-6 py-4">
                        {renderExpanded!(row, index)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {footer && (
            <tfoot className="bg-slate-50 dark:bg-slate-900/40 border-t-2 border-slate-300 dark:border-slate-500">
              {footer}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export default InventoryTable;

// ── Helper render functions for common cell patterns ──

/** Icon chip — rounded-lg colored box with an icon, matching InventoryCoordination style. */
export function IconChip({
  icon,
  soft,
  text,
  size = 16,
}: {
  icon: ReactNode;
  soft: string;
  text: string;
  size?: number;
}) {
  return (
    <div
      className={`shrink-0 p-2 rounded-lg ${soft}`}
      style={{ width: size + 16, height: size + 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span className={text} style={{ display: 'flex' }}>
        {icon}
      </span>
    </div>
  );
}

/** Product/identity cell — icon chip + name + code, matching InventoryCoordination style. */
export function IdentityCell({
  icon,
  soft,
  text,
  name,
  code,
}: {
  icon: ReactNode;
  soft: string;
  text: string;
  name: string;
  code?: string;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <IconChip icon={icon} soft={soft} text={text} />
      <div className="min-w-0">
        <p className="font-medium text-gray-900 dark:text-white truncate">{name}</p>
        {code && (
          <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">{code}</span>
        )}
      </div>
    </div>
  );
}

/** Stock quantity cell — number + unit, with optional low-stock color. */
export function StockCell({
  value,
  unit,
  isLow,
  sublabel,
}: {
  value: number | string;
  unit?: string;
  isLow?: boolean;
  sublabel?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`font-medium ${isLow ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>
          {value} {unit && <span className="text-xs text-slate-500 dark:text-slate-400">{unit}</span>}
        </span>
      </div>
      {sublabel && <p className="text-xs text-slate-400">{sublabel}</p>}
    </div>
  );
}

/** Value cell — cost with sublabel. */
export function ValueCell({ value, sublabel }: { value: string; sublabel?: string }) {
  return (
    <div className="font-medium text-slate-700 dark:text-slate-300">
      {value}
      {sublabel && <p className="text-xs text-slate-400 mt-0.5">{sublabel}</p>}
    </div>
  );
}

/** Tag pill — small label in a rounded box. */
export function TagPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      {children}
    </span>
  );
}

/** Ops cell — action buttons (always visible, matching InventoryCoordination). */
export function OpsCell({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {children}
    </div>
  );
}

/** Icon action button for the ops cell. */
export function IconButton({
  onClick,
  title,
  variant = 'neutral',
  disabled,
  children,
}: {
  onClick?: () => void;
  title?: string;
  variant?: 'neutral' | 'danger' | 'info' | 'success';
  disabled?: boolean;
  children: ReactNode;
}) {
  const colors = {
    neutral: 'text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400',
    danger: 'text-slate-400 hover:text-red-600 dark:hover:text-red-400',
    info: 'text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400',
    success: 'text-slate-400 hover:text-green-600 dark:hover:text-green-400',
  };
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1 transition-colors ${colors[variant]} disabled:opacity-50`}
    >
      {children}
    </button>
  );
}
