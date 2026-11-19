/**
 * Unified Inventory & Stores Portal — /erp/inventory/:tab
 * Renders the expanded spec modules (DB-backed via /api/uinv-portal).
 *
 * Tab structure (consolidated from 22 → 14 tabs for easier management):
 *   - dashboard                  → UnifiedInventoryDashboard (with integrated global search)
 *   - items                      → ItemMasterModule
 *   - inventory                  → InventoryModule
 *   - stores                     → StoresModule
 *   - stock-operations           → StockOperationsModule (issues/transfers/receiving/borrows)
 *   - storekeeping               → StorekeepingModule (put-away/picking/returns/quarantine/serials/expiry)
 *   - stock-control              → StockControlWrapper (adjustments + counts + waste + consumption)
 *   - reservations               → ReservationsModule
 *   - replenishment-procurement  → ReplenishmentProcurementWrapper (replenishment + supply procurement)
 *   - assets-resources           → AssetsResourcesWrapper (fixed assets + physical resources + verification)
 *   - reports                    → ReportsWrapper (valuation + reports)
 *   - audit                      → GovernanceModule (periods/audit/approvals/journals)
 *   - advanced-operations        → AdvancedOperationsModule (critical spares/compatibility/guest custody/store ops)
 *   - configuration              → ConfigurationModule
 */
import React from 'react';
import UnifiedInventoryDashboard from './UnifiedInventoryDashboard';
import ItemMasterModule from './ItemMasterModule';
import InventoryModule from './InventoryModule';
import StoresModule from './StoresModule';
import StockOperationsModule from './StockOperationsModule';
import StorekeepingModule from './StorekeepingModule';
import StockControlWrapper from './StockControlWrapper';
import ReservationsModule from './ReservationsModule';
import ReplenishmentProcurementWrapper from './ReplenishmentProcurementWrapper';
import AssetsResourcesWrapper from './AssetsResourcesWrapper';
import ReportsWrapper from './ReportsWrapper';
import GovernanceModule from './GovernanceModule';
import AdvancedOperationsModule from './AdvancedOperationsModule';
import ConfigurationModule from './ConfigurationModule';

const InventoryPortal: React.FC<{ activeTab?: string }> = ({ activeTab = 'dashboard' }) => {
  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 animate-fade-in">
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'dashboard' && <UnifiedInventoryDashboard />}
        {activeTab === 'items' && <ItemMasterModule />}
        {activeTab === 'inventory' && <InventoryModule />}
        {activeTab === 'stores' && <StoresModule />}
        {activeTab === 'stock-operations' && <StockOperationsModule />}
        {['receiving','issues-returns','transfers'].includes(activeTab || '') && <StockOperationsModule initialTab={activeTab as any} />}
        {activeTab === 'storekeeping' && <StorekeepingModule />}
        {['put-away','picking','batch-lot-serial','expiry','quarantine'].includes(activeTab || '') && (
          <StorekeepingModule initialTab={
            activeTab === 'put-away' ? 'putaway' :
            activeTab === 'picking' ? 'picking' :
            activeTab === 'batch-lot-serial' ? 'serials-lots' :
            activeTab === 'expiry' ? 'expiry' :
            'quarantine'
          } />
        )}
        {activeTab === 'stock-control' && <StockControlWrapper />}
        {['adjustments','stock-counts','waste','consumption'].includes(activeTab || '') && (
          <StockControlWrapper initialTab={
            activeTab === 'adjustments' ? 'adjustments' :
            activeTab === 'stock-counts' ? 'counts' :
            activeTab === 'waste' ? 'waste' :
            'consumption'
          } />
        )}
        {activeTab === 'reservations' && <ReservationsModule />}
        {activeTab === 'reservations-allocations' && <ReservationsModule />}
        {activeTab === 'replenishment-procurement' && <ReplenishmentProcurementWrapper />}
        {activeTab === 'replenishment' && <ReplenishmentProcurementWrapper initialTab="replenishment" />}
        {activeTab === 'supply-procurement' && <ReplenishmentProcurementWrapper initialTab="supply-procurement" />}
        {activeTab === 'assets-resources' && <AssetsResourcesWrapper />}
        {activeTab === 'fixed-assets' && <AssetsResourcesWrapper initialTab="fixed-assets" />}
        {activeTab === 'physical-resources' && <AssetsResourcesWrapper initialTab="physical-resources" />}
        {['equipment-tools','linen','uniforms','returnables','loanables'].includes(activeTab || '') && (
          <AssetsResourcesWrapper initialTab="physical-resources" />
        )}
        {activeTab === 'physical-verification' && <AssetsResourcesWrapper initialTab="verification" />}
        {activeTab === 'reports' && <ReportsWrapper />}
        {activeTab === 'valuation' && <ReportsWrapper initialTab="valuation" />}
        {activeTab === 'audit' && <GovernanceModule initialTab="audit" />}
        {activeTab === 'advanced-operations' && <AdvancedOperationsModule initialTab="critical-spares" />}
        {activeTab === 'configuration' && <ConfigurationModule />}
      </div>
    </div>
  );
};

export default InventoryPortal;
