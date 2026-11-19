/**
 * Revenue Management Portal
 * Phase 2: RMS Dashboard with dynamic pricing, demand forecasting, and competitor analysis
 */

import RMSDashboard from './RMSDashboard';
import PricingRecommendations from './PricingRecommendations';
import CompetitorManagement from './CompetitorManagement';
import DemandForecasts from './DemandForecasts';
import LOSRules from './LOSRules';
import CorporateRates from './CorporateRates';
import ChannelManager from './ChannelManager';
import DynamicPricing from './DynamicPricing';
import RateManagement from './RateManagement';
import InventoryControls from './InventoryControls';
import YieldManagement from './YieldManagement';
import MarketSegmentation from './MarketSegmentation';
import ChannelPerformance from './ChannelPerformance';
import DistributionManagement from './DistributionManagement';
import GroupEvaluation from './GroupEvaluation';
import DisplacementAnalysis from './DisplacementAnalysis';
import OverbookingManagement from './OverbookingManagement';
import RestrictionsManagement from './RestrictionsManagement';
import PackagePricing from './PackagePricing';
import PromotionsAnalysis from './PromotionsAnalysis';
import BusinessIntelligence from './BusinessIntelligence';
import AIRecommendations from './AIRecommendations';
import ScenarioPlanning from './ScenarioPlanning';
import Reports from './Reports';
import Configuration from './Configuration';
import DepartmentRequisitionForm from '../Inventory/DepartmentRequisitionForm';

const RevenueManagementPortal = ({ activeModule = 'dashboard' }: { activeModule?: string }) => {
  return (
    <div className="flex flex-col h-full font-sans bg-slate-50 dark:bg-slate-900">
      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-auto">
        {activeModule === 'dashboard' && <RMSDashboard />}
        {activeModule === 'recommendations' && <PricingRecommendations />}
        {activeModule === 'competitors' && <CompetitorManagement />}
        {activeModule === 'forecasts' && <DemandForecasts />}
        {activeModule === 'los' && <LOSRules />}
        {activeModule === 'corporate' && <CorporateRates />}
        {activeModule === 'channels' && <ChannelManager />}
        {activeModule === 'dynamic_pricing' && <DynamicPricing />}
        {activeModule === 'rate_management' && <RateManagement />}
        {activeModule === 'inventory_controls' && <InventoryControls />}
        {activeModule === 'yield_management' && <YieldManagement />}
        {activeModule === 'market_segmentation' && <MarketSegmentation />}
        {activeModule === 'channel_performance' && <ChannelPerformance />}
        {activeModule === 'distribution_management' && <DistributionManagement />}
        {activeModule === 'group_evaluation' && <GroupEvaluation />}
        {activeModule === 'displacement_analysis' && <DisplacementAnalysis />}
        {activeModule === 'overbooking_management' && <OverbookingManagement />}
        {activeModule === 'restrictions_management' && <RestrictionsManagement />}
        {activeModule === 'package_pricing' && <PackagePricing />}
        {activeModule === 'promotions_analysis' && <PromotionsAnalysis />}
        {activeModule === 'business_intelligence' && <BusinessIntelligence />}
        {activeModule === 'ai_recommendations' && <AIRecommendations />}
        {activeModule === 'scenario_planning' && <ScenarioPlanning />}
        {activeModule === 'requisitions' && <DepartmentRequisitionForm department="Revenue Management" />}
        {activeModule === 'reports' && <Reports />}
        {activeModule === 'configuration' && <Configuration />}
      </div>
    </div>
  );
};

export default RevenueManagementPortal;
