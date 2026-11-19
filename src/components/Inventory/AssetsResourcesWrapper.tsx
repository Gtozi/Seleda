/**
 * Assets & Resources Wrapper — /erp/inventory/assets-resources
 *
 * Consolidates the three physical-resource management modules into one
 * tabbed view for easier management:
 *   - Fixed Assets          (FixedAssetsModule)
 *   - Physical Resources    (PhysicalResourcesModule — tools, linen, uniforms, returnables, loanables)
 *   - Physical Verification (PhysicalVerificationModule — campaigns, asset/resource verification)
 *
 * The sub-tab bar is passed into each child module via the `subTabBar` prop
 * so it renders below the KPI stat cards (matching the portal-wide pattern).
 */
import React, { useState } from 'react';
import { Boxes, Wrench, ClipboardCheck } from 'lucide-react';
import { SectionCard } from '../FrontOffice/ui';
import FixedAssetsModule from './FixedAssetsModule';
import PhysicalResourcesModule from './PhysicalResourcesModule';
import PhysicalVerificationModule from './PhysicalVerificationModule';

type SubTab = 'fixed-assets' | 'physical-resources' | 'verification';

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
  { id: 'fixed-assets', label: 'Fixed Assets', icon: Boxes },
  { id: 'physical-resources', label: 'Physical Resources', icon: Wrench },
  { id: 'verification', label: 'Physical Verification', icon: ClipboardCheck },
];

interface AssetsResourcesWrapperProps {
  initialTab?: SubTab;
}

const AssetsResourcesWrapper: React.FC<AssetsResourcesWrapperProps> = ({ initialTab = 'fixed-assets' }) => {
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
      {tab === 'fixed-assets' && <FixedAssetsModule subTabBar={subTabBar} />}
      {tab === 'physical-resources' && <PhysicalResourcesModule subTabBar={subTabBar} />}
      {tab === 'verification' && <PhysicalVerificationModule subTabBar={subTabBar} />}
    </div>
  );
};

export default AssetsResourcesWrapper;
