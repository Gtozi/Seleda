import React from 'react';
import { resolveAdminModule } from './adminModules';
import { layout } from '../FrontOffice/brandTheme';

const AdminPortal = ({ activeModule = 'executive_dashboard' }: { activeModule?: string }) => {
  const config = resolveAdminModule(activeModule);
  const Component = config.component;
  return (
    <div className={['accent-admin', layout.sectionStack, 'animate-fade-in font-sans'].join(' ')} id="admin-portal">
      <div className="min-h-[600px] min-w-0 text-slate-850 dark:text-slate-100">
        <Component activeModule={activeModule} />
      </div>
    </div>
  );
};

export default AdminPortal;
