/**
 * Replenishment & Procurement Wrapper — /erp/inventory/replenishment-procurement
 *
 * Consolidates the two "get more stock" workflows into one tabbed view:
 *   - Replenishment & Planning (ReplenishmentModule — suggestions, auto-replenish,
 *     dynamic par, pulls, par overrides, procurement trigger)
 *   - Supply & Procurement     (SupplyProcurementModule — demand, requisitions, suppliers)
 *
 * The sub-tab bar is passed into each child module via the `subTabBar` prop
 * so it renders below the KPI stat cards (matching the portal-wide pattern).
 */
import React, { useState } from 'react';
import { TrendingUp, ShoppingCart } from 'lucide-react';
import { SectionCard } from '../FrontOffice/ui';
import ReplenishmentModule from './ReplenishmentModule';
import SupplyProcurementModule from './SupplyProcurementModule';

type SubTab = 'replenishment' | 'supply-procurement';

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
  { id: 'replenishment', label: 'Replenishment & Planning', icon: TrendingUp },
  { id: 'supply-procurement', label: 'Supply & Procurement', icon: ShoppingCart },
];

interface ReplenishmentProcurementWrapperProps {
  initialTab?: SubTab;
}

const ReplenishmentProcurementWrapper: React.FC<ReplenishmentProcurementWrapperProps> = ({ initialTab = 'replenishment' }) => {
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
      {tab === 'replenishment' && <ReplenishmentModule subTabBar={subTabBar} />}
      {tab === 'supply-procurement' && <SupplyProcurementModule subTabBar={subTabBar} />}
    </div>
  );
};

export default ReplenishmentProcurementWrapper;
