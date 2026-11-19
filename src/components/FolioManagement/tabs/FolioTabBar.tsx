/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FolioTabs — tab bar + tab routing (spec §11).
 */
import React from 'react';
import { FileText, Receipt, CreditCard, FileCheck, StickyNote, FolderOpen, History } from 'lucide-react';

export type TabId = 'summary' | 'transactions' | 'payments' | 'invoices' | 'notes' | 'documents' | 'activity';

export const TAB_DEFS: { id: TabId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'summary', label: 'Summary', icon: FileText },
  { id: 'transactions', label: 'Transactions', icon: Receipt },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'invoices', label: 'Invoices', icon: FileCheck },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'documents', label: 'Documents', icon: FolderOpen },
  { id: 'activity', label: 'Activity', icon: History },
];

export function FolioTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-6 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto">
      {TAB_DEFS.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              active
                ? 'border-[var(--color-accent-operations)] text-[var(--color-accent-operations)]'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
