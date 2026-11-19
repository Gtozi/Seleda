/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * FoodBeveragePortal — F&B Portal.
 *
 * Per the route-driven architecture, `activeTab` is derived from the URL by
 * DepartmentRoute. This component simply renders the module that corresponds
 * to the active tab. See `FB portal new.md` for the unified F&B architecture.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ExecutiveDashboard from './ExecutiveDashboard';
import OutletManagement from './OutletManagement';
import MenuCatalogManagement from './MenuCatalogManagement';
import RecipeProductionManagement from './RecipeProductionManagement';
import PricingPackages from './PricingPackages';
import ServiceOperations from './ServiceOperations';
import ProductionCoordination from './ProductionCoordination';
import BanquetFB from './BanquetFB';
import RoomServiceManagement from './RoomServiceManagement';
import InventoryCostControl from './InventoryCostControl';
import InventoryCoordination from './InventoryCoordination';
import PurchasingSupplierManagement from './PurchasingSupplierManagement';
import SupplierProcurementCoordination from './SupplierProcurementCoordination';
import GuestExperienceCRM from './GuestExperienceCRM';
import StaffOperations from './StaffOperations';
import OperationsCompliance from './OperationsCompliance';
import FBFinancials from './FBFinancials';
import FBReports from './FBReports';
import Configuration from './Configuration';
import Integrations from './Integrations';

export default function FoodBeveragePortal({ activeTab, onTabChange }: { activeTab: string; onTabChange?: (tab: string) => void }) {
  const [searchParams] = useSearchParams();

  // Read URL parameters for deep-linking (module switch) — mirrors Front Office portal
  useEffect(() => {
    const module = searchParams.get('module');
    if (module) {
      onTabChange?.(module);
    }
  }, [searchParams, onTabChange]);

  return (
    <div className="accent-fb space-y-6 animate-fade-in" id="fb-portal">
      <div className="min-h-[600px]">
        {activeTab === 'executive-dashboard' && <ExecutiveDashboard />}
        {activeTab === 'outlet-management' && <OutletManagement />}
        {activeTab === 'menu-management' && <MenuCatalogManagement />}
        {activeTab === 'recipe-management' && <RecipeProductionManagement />}
        {activeTab === 'pricing-packages' && <PricingPackages />}
        {activeTab === 'service-operations' && <ServiceOperations />}
        {activeTab === 'production-coordination' && <ProductionCoordination />}
        {activeTab === 'banquet-fb' && <BanquetFB />}
        {activeTab === 'room-service' && <RoomServiceManagement />}
        {activeTab === 'inventory-coordination' && <InventoryCoordination />}
        {activeTab === 'procurement-coordination' && <SupplierProcurementCoordination />}
        {activeTab === 'guest-experience' && <GuestExperienceCRM />}
        {activeTab === 'staff-operations' && <StaffOperations />}
        {activeTab === 'quality-compliance' && <OperationsCompliance />}
        {activeTab === 'financials' && <FBFinancials />}
        {activeTab === 'reports' && <FBReports />}
        {activeTab === 'configuration' && <Configuration />}
        {activeTab === 'integrations' && <Integrations />}
      </div>
    </div>
  );
}
