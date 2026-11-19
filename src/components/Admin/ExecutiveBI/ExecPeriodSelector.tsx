/**
 * Shared Executive reporting-window selector: calendar presets
 * (Today / WTD / MTD / QTD / YTD) plus rolling day windows.
 */

import { EXEC_PERIODS, type ExecWindow } from '../../../services/executiveService';

const ROLLING: { id: ExecWindow; label: string }[] = [
  { id: 7, label: '7D' },
  { id: 30, label: '30D' },
  { id: 90, label: '90D' },
  { id: 365, label: '1Y' },
];

export function windowLabel(w: ExecWindow): string {
  if (typeof w === 'number') return `last ${w} days`;
  return EXEC_PERIODS.find(p => p.id === w)?.label || w.toUpperCase();
}

export const ExecPeriodSelector = ({
  value,
  onChange,
}: {
  value: ExecWindow;
  onChange: (w: ExecWindow) => void;
}) => {
  const btn = (active: boolean) =>
    `px-3 py-2 text-sm ${active
      ? 'bg-indigo-600 text-white'
      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`;
  return (
    <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
      {EXEC_PERIODS.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)} className={btn(value === p.id)}>
          {p.label}
        </button>
      ))}
      <span className="w-px bg-gray-300 dark:bg-gray-600" />
      {ROLLING.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)} className={btn(value === p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  );
};

export default ExecPeriodSelector;
