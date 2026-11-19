/**
 * Executive & Business Intelligence (EBI) Portal
 * Version: 2.0
 * 
 * The executive command center of the Hotel ERP that consolidates information from every
 * ERP module into a single source of truth for strategic decision-making.
 * 
 * This portal does not own operational data - it consumes, aggregates, analyzes, and
 * visualizes enterprise data without becoming the system of record.
 */

import {
  LayoutGrid,
  BarChart3,
  Activity,
  DollarSign,
  Users,
  Utensils,
  Wrench,
  Briefcase,
  ShoppingCart,
  Shield,
  Leaf,
  Scale,
  Target,
  TrendingUp,
  AlertTriangle,
  FileBarChart,
  Calendar,
  Zap,
  Award,
  ClipboardCheck,
  Database,
  Sliders
} from 'lucide-react';

// Module imports
import ExecutiveDashboard from './ExecutiveBI/modules/ExecutiveDashboard';
import EnterpriseKPIcenter from './ExecutiveBI/modules/EnterpriseKPIcenter';
import OperationalIntelligence from './ExecutiveBI/modules/OperationalIntelligence';
import FinancialIntelligence from './ExecutiveBI/modules/FinancialIntelligence';
import RevenueIntelligence from './ExecutiveBI/modules/RevenueIntelligence';
import GuestIntelligence from './ExecutiveBI/modules/GuestIntelligence';
import SalesMarketingIntelligence from './ExecutiveBI/modules/SalesMarketingIntelligence';
import FoodBeverageIntelligence from './ExecutiveBI/modules/FoodBeverageIntelligence';
import HousekeepingIntelligence from './ExecutiveBI/modules/HousekeepingIntelligence';
import EngineeringIntelligence from './ExecutiveBI/modules/EngineeringIntelligence';
import HumanCapitalIntelligence from './ExecutiveBI/modules/HumanCapitalIntelligence';
import ProcurementIntelligence from './ExecutiveBI/modules/ProcurementIntelligence';
import InventoryIntelligence from './ExecutiveBI/modules/InventoryIntelligence';
import SecurityIntelligence from './ExecutiveBI/modules/SecurityIntelligence';
import SustainabilityIntelligence from './ExecutiveBI/modules/SustainabilityIntelligence';
import Benchmarking from './ExecutiveBI/modules/Benchmarking';
import Forecasting from './ExecutiveBI/modules/Forecasting';
import AIDecisionSupport from './ExecutiveBI/modules/AIDecisionSupport';
import StrategicPlanning from './ExecutiveBI/modules/StrategicPlanning';
import AlertsExceptions from './ExecutiveBI/modules/AlertsExceptions';
import ApprovalsCenter from './ExecutiveBI/modules/ApprovalsCenter';
import ReportsCenter from './ExecutiveBI/modules/ReportsCenter';
import Configuration from './ExecutiveBI/modules/Configuration';

type EBIModule = 
  | 'executive-dashboard'
  | 'enterprise-kpi-center'
  | 'operational-intelligence'
  | 'financial-intelligence'
  | 'revenue-intelligence'
  | 'guest-intelligence'
  | 'sales-marketing-intelligence'
  | 'food-beverage-intelligence'
  | 'housekeeping-intelligence'
  | 'engineering-intelligence'
  | 'human-capital-intelligence'
  | 'procurement-intelligence'
  | 'inventory-intelligence'
  | 'security-intelligence'
  | 'sustainability-intelligence'
  | 'benchmarking'
  | 'forecasting'
  | 'ai-decision-support'
  | 'strategic-planning'
  | 'alerts-exceptions'
  | 'approvals'
  | 'reports-center'
  | 'configuration';

interface ModuleConfig {
  id: EBIModule;
  label: string;
  icon: any;
  description: string;
  category: 'dashboard' | 'intelligence' | 'analytics' | 'planning' | 'management';
  priority: 'high' | 'medium' | 'low';
}

const MODULES: ModuleConfig[] = [
  // Dashboard
  { 
    id: 'executive-dashboard', 
    label: 'Executive Dashboard', 
    icon: LayoutGrid, 
    description: 'Enterprise KPIs & strategic metrics', 
    category: 'dashboard', 
    priority: 'high' 
  },
  { 
    id: 'enterprise-kpi-center', 
    label: 'Enterprise KPI Center', 
    icon: BarChart3, 
    description: 'KPI scorecards & trend analysis', 
    category: 'dashboard', 
    priority: 'high' 
  },
  
  // Intelligence Modules
  { 
    id: 'operational-intelligence', 
    label: 'Operational Intelligence', 
    icon: Activity, 
    description: 'Consolidated operational analytics', 
    category: 'intelligence', 
    priority: 'high' 
  },
  { 
    id: 'financial-intelligence', 
    label: 'Financial Intelligence', 
    icon: DollarSign, 
    description: 'P&L, cash flow, budget analysis', 
    category: 'intelligence', 
    priority: 'high' 
  },
  { 
    id: 'revenue-intelligence', 
    label: 'Revenue Intelligence', 
    icon: TrendingUp, 
    description: 'Occupancy, ADR, RevPAR analytics', 
    category: 'intelligence', 
    priority: 'high' 
  },
  { 
    id: 'guest-intelligence', 
    label: 'Guest Intelligence', 
    icon: Users, 
    description: 'Guest demographics & satisfaction', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'sales-marketing-intelligence', 
    label: 'Sales & Marketing Intelligence', 
    icon: Target, 
    description: 'Pipeline, conversion, campaign ROI', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'food-beverage-intelligence', 
    label: 'Food & Beverage Intelligence', 
    icon: Utensils, 
    description: 'Restaurant performance & menu analysis', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'housekeeping-intelligence', 
    label: 'Housekeeping Intelligence', 
    icon: Award, 
    description: 'Productivity & room turnaround', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'engineering-intelligence', 
    label: 'Engineering Intelligence', 
    icon: Wrench, 
    description: 'Asset performance & maintenance', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'human-capital-intelligence', 
    label: 'Human Capital Intelligence', 
    icon: Briefcase, 
    description: 'Headcount, labor cost, productivity', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'procurement-intelligence', 
    label: 'Procurement Intelligence', 
    icon: ShoppingCart, 
    description: 'Spend analysis & vendor performance', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'inventory-intelligence', 
    label: 'Inventory Intelligence', 
    icon: Database, 
    description: 'Stock value & turnover analysis', 
    category: 'intelligence', 
    priority: 'low' 
  },
  { 
    id: 'security-intelligence', 
    label: 'Security Intelligence', 
    icon: Shield, 
    description: 'Incidents & risk analytics', 
    category: 'intelligence', 
    priority: 'medium' 
  },
  { 
    id: 'sustainability-intelligence', 
    label: 'Sustainability Intelligence', 
    icon: Leaf, 
    description: 'ESG metrics & environmental KPIs', 
    category: 'intelligence', 
    priority: 'low' 
  },
  
  // Analytics
  { 
    id: 'benchmarking', 
    label: 'Benchmarking', 
    icon: Scale, 
    description: 'Compare vs budget, forecast, industry', 
    category: 'analytics', 
    priority: 'medium' 
  },
  { 
    id: 'forecasting', 
    label: 'Forecasting', 
    icon: Calendar, 
    description: 'Revenue, occupancy, demand forecasts', 
    category: 'analytics', 
    priority: 'high' 
  },
  { 
    id: 'ai-decision-support', 
    label: 'AI Decision Support', 
    icon: Zap, 
    description: 'AI-powered recommendations', 
    category: 'analytics', 
    priority: 'medium' 
  },
  
  // Planning
  { 
    id: 'strategic-planning', 
    label: 'Strategic Planning', 
    icon: ClipboardCheck, 
    description: 'Business plans, OKRs, targets', 
    category: 'planning', 
    priority: 'medium' 
  },
  
  // Management
  { 
    id: 'alerts-exceptions', 
    label: 'Alerts & Exceptions', 
    icon: AlertTriangle, 
    description: 'Real-time alerts & exceptions', 
    category: 'management', 
    priority: 'high' 
  },
  {
    id: 'approvals',
    label: 'Approvals & Decisions',
    icon: ClipboardCheck,
    description: 'Enterprise approval queue with executive sign-off',
    category: 'management',
    priority: 'high'
  },
  {
    id: 'reports-center',
    label: 'Reports Center',
    icon: FileBarChart,
    description: 'Executive & operational reports',
    category: 'management',
    priority: 'high'
  },
  { 
    id: 'configuration', 
    label: 'Configuration', 
    icon: Sliders, 
    description: 'Dashboard setup & KPI configuration', 
    category: 'management', 
    priority: 'low' 
  },
];

const ExecutiveBusinessIntelligencePortal = ({ activeTab }: { activeTab?: string }) => {
  // URL-driven: `activeTab` (from /erp/executive/:tab) is the source of truth.
  const activeModule: EBIModule =
    activeTab && MODULES.some(m => m.id === activeTab)
      ? (activeTab as EBIModule)
      : 'executive-dashboard';

  return (
    <div className="space-y-6 animate-fade-in" id="executive-business-intelligence-portal">
      {/* Module Content */}
      <div className="min-h-[600px]">
        {activeModule === 'executive-dashboard' && <ExecutiveDashboard />}
        {activeModule === 'enterprise-kpi-center' && <EnterpriseKPIcenter />}
        {activeModule === 'operational-intelligence' && <OperationalIntelligence />}
        {activeModule === 'financial-intelligence' && <FinancialIntelligence />}
        {activeModule === 'revenue-intelligence' && <RevenueIntelligence />}
        {activeModule === 'guest-intelligence' && <GuestIntelligence />}
        {activeModule === 'sales-marketing-intelligence' && <SalesMarketingIntelligence />}
        {activeModule === 'food-beverage-intelligence' && <FoodBeverageIntelligence />}
        {activeModule === 'housekeeping-intelligence' && <HousekeepingIntelligence />}
        {activeModule === 'engineering-intelligence' && <EngineeringIntelligence />}
        {activeModule === 'human-capital-intelligence' && <HumanCapitalIntelligence />}
        {activeModule === 'procurement-intelligence' && <ProcurementIntelligence />}
        {activeModule === 'inventory-intelligence' && <InventoryIntelligence />}
        {activeModule === 'security-intelligence' && <SecurityIntelligence />}
        {activeModule === 'sustainability-intelligence' && <SustainabilityIntelligence />}
        {activeModule === 'benchmarking' && <Benchmarking />}
        {activeModule === 'forecasting' && <Forecasting />}
        {activeModule === 'ai-decision-support' && <AIDecisionSupport />}
        {activeModule === 'strategic-planning' && <StrategicPlanning />}
        {activeModule === 'alerts-exceptions' && <AlertsExceptions />}
        {activeModule === 'approvals' && <ApprovalsCenter />}
        {activeModule === 'reports-center' && <ReportsCenter />}
        {activeModule === 'configuration' && <Configuration />}
      </div>
    </div>
  );
};

export default ExecutiveBusinessIntelligencePortal;
