/**
 * PeriodSelector — shared date-range toggle used by Valuation & Reports.
 *
 * Mirrors the F&B reports pattern: Today / WTD / MTD / YTD / Custom,
 * resolving abstract labels to concrete calendar dates so every API call,
 * KPI, and exported document is auditable against a real date range.
 */
import React, { useMemo, useState } from 'react';

export type Period = 'Today' | 'WTD' | 'MTD' | 'YTD' | 'Custom';

export const PERIODS: Period[] = ['Today', 'WTD', 'MTD', 'YTD', 'Custom'];

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

export function periodDateRange(p: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  switch (p) {
    case 'Today':
      return { from: today, to: today };
    case 'WTD':
      return { from: toISODate(startOfWeek(now)), to: today };
    case 'MTD':
      return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'YTD':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today };
    case 'Custom':
    default:
      return { from: customFrom, to: customTo };
  }
}

export function defaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  const today = toISODate(now);
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

export function periodLabel(p: Period, from: string, to: string): string {
  const range = periodDateRange(p, from, to);
  return p === 'Custom' ? `${range.from} → ${range.to}` : `${p} (${range.from} → ${range.to})`;
}

interface PeriodSelectorProps {
  period: Period;
  onPeriodChange: (p: Period) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
}

const PeriodSelector: React.FC<PeriodSelectorProps> = ({
  period, onPeriodChange, customFrom, customTo, onCustomFromChange, onCustomToChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => {
              if (p === 'Custom') {
                const range = defaultCustomRange();
                onCustomFromChange(range.from);
                onCustomToChange(range.to);
              }
              onPeriodChange(p);
            }}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? 'bg-[var(--color-accent-operations)] text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      {period === 'Custom' && (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            value={customFrom}
            onChange={e => onCustomFromChange(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={customTo}
            onChange={e => onCustomToChange(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
          />
        </div>
      )}
    </div>
  );
};

/**
 * Hook that encapsulates period + custom date state and memoizes the
 * resolved concrete date range and human-readable label.
 */
export function usePeriodRange() {
  const [period, setPeriod] = useState<Period>('MTD');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  const activeRange = useMemo(
    () => periodDateRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );
  const activeLabel = useMemo(
    () => periodLabel(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  return {
    period, setPeriod,
    customFrom, setCustomFrom,
    customTo, setCustomTo,
    activeRange, activeLabel,
  };
}

export default PeriodSelector;
