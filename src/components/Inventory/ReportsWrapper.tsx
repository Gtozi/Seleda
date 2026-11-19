/**
 * Valuation & Reports Wrapper — /erp/inventory/reports
 *
 * Consolidates the two reporting/analysis modules into one tabbed view:
 *   - Valuation (ValuationModule — inventory & asset valuation by costing method)
 *   - Reports   (ReportsModule — standard inventory reports)
 *
 * The sub-tab bar is passed into each child module via the `subTabBar` prop
 * so it renders below the KPI stat cards (matching the portal-wide pattern).
 */
import React, { useState } from 'react';
import { DollarSign, BarChart3 } from 'lucide-react';
import { SectionCard } from '../FrontOffice/ui';
import ValuationModule from './ValuationModule';
import ReportsModule from './ReportsModule';

type SubTab = 'valuation' | 'reports';

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
  { id: 'valuation', label: 'Valuation', icon: DollarSign },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

interface ReportsWrapperProps {
  initialTab?: SubTab;
}

const ReportsWrapper: React.FC<ReportsWrapperProps> = ({ initialTab = 'reports' }) => {
  const [tab, setTab] = useState<SubTab>(initialTab);

  const subTabBar = (
    <SectionCard pad="md">
      <div className="flex bg-slate-100 dark:bg-slate-900/40 p-1 rounded-xl gap-1 overflow-x-auto">
        {SUB_TABS.map(st => {
          const Icon = st.icon;
          return (
            <button
              key={st.id}
              onClick={() => setTab(st.id)}
              className={[
                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                tab === st.id
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-slate-300',
              ].join(' ')}
            >
              <Icon className="w-3.5 h-3.5" />
              {st.label}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );

  return (
    <div className="animate-fade-in">
      {tab === 'valuation' && <ValuationModule subTabBar={subTabBar} />}
      {tab === 'reports' && <ReportsModule subTabBar={subTabBar} />}
    </div>
  );
};

export default ReportsWrapper;
