/**
 * Stock Control Wrapper — /erp/inventory/stock-control
 *
 * Consolidates the four balance-changing / observation modules into one
 * tabbed view for easier management:
 *   - Adjustments  (StockControlModule)
 *   - Stock Counts (StockCountsModule)
 *   - Waste        (WasteModule)
 *   - Consumption  (ConsumptionModule)
 *
 * The sub-tab bar is passed into each child module via the `subTabBar` prop
 * so it renders below the KPI stat cards (matching the portal-wide pattern).
 */
import React, { useState } from 'react';
import { SlidersHorizontal, ClipboardCheck, Trash2, TrendingDown, Search } from 'lucide-react';
import { SectionCard } from '../FrontOffice/ui';
import StockControlModule from './StockControlModule';
import StockCountsModule from './StockCountsModule';
import WasteModule from './WasteModule';
import ConsumptionModule from './ConsumptionModule';
import VarianceInvestigationModule from './VarianceInvestigationModule';

type SubTab = 'adjustments' | 'counts' | 'waste' | 'consumption' | 'variance';

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
  { id: 'adjustments', label: 'Adjustments', icon: SlidersHorizontal },
  { id: 'counts', label: 'Stock Counts', icon: ClipboardCheck },
  { id: 'variance', label: 'Variance Investigations', icon: Search },
  { id: 'waste', label: 'Waste / Spoilage', icon: Trash2 },
  { id: 'consumption', label: 'Consumption', icon: TrendingDown },
];

interface StockControlWrapperProps {
  initialTab?: SubTab;
}

const StockControlWrapper: React.FC<StockControlWrapperProps> = ({ initialTab = 'adjustments' }) => {
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
      {tab === 'adjustments' && <StockControlModule subTabBar={subTabBar} />}
      {tab === 'counts' && <StockCountsModule subTabBar={subTabBar} />}
      {tab === 'variance' && <VarianceInvestigationModule subTabBar={subTabBar} />}
      {tab === 'waste' && <WasteModule subTabBar={subTabBar} />}
      {tab === 'consumption' && <ConsumptionModule subTabBar={subTabBar} />}
    </div>
  );
};

export default StockControlWrapper;
