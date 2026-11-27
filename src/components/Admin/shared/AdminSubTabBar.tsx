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
 * Aligned 100% with the Finance Portal sub-tab navigation.
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
        'flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 flex-wrap',
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
              'px-4 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap inline-flex items-center gap-1.5',
              active
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
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
