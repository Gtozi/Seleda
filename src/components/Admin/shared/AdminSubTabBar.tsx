import React from 'react';

export interface AdminSubTab<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface AdminSubTabBarProps<T extends string = string> {
  tabs: readonly AdminSubTab<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  className?: string;
}

/**
 * Shared sub-tab bar for multi-tab Admin Portal modules.
 * Matches the earthy-luxury brandTheme tokens and supports light/dark mode.
 */
export function AdminSubTabBar<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  className = '',
}: AdminSubTabBarProps<T>) {
  return (
    <div
      className={[
        'inline-flex flex-wrap items-center gap-1 p-1 rounded-xl',
        'bg-slate-100 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700',
        className,
      ].join(' ')}
    >
      {tabs.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              'px-3.5 py-2 flex items-center justify-center gap-2 rounded-lg text-xs font-medium transition-all',
              active
                ? 'bg-[var(--color-accent-operations)] text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-slate-700/60',
            ].join(' ')}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
