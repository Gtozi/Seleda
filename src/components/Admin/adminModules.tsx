/**
 * Admin Module Registry
 * Single source of truth for all System Administration modules.
 * Used by App.tsx (tab bar) and AdminPortal.tsx (content router).
 * Consolidated from 27 flat tabs into 13 domain hubs with sub-tabs.
 */

import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Shield,
  Layers,
  Database,
  GitBranch,
  Mail,
  Cpu,
  CreditCard,
  Settings,
  Key,
  Activity,
  FileBarChart,
  type LucideIcon,
} from 'lucide-react';

import AdminOverview from './modules/AdminOverview';
import AdminReports from './modules/AdminReports';
import UserManagementSecurity from './UserManagementSecurity';
import GlobalSystemSettings from './GlobalSystemSettings';
import MasterData from './MasterData';
import APIManagement from './APIManagement';
import { TemplatesModule, PaymentGatewayModule } from './modules/ControlModules';
import {
  TenantPropertyHub,
  PortalFeatureHub,
  RulesWorkflowsHub,
  PosDevicesHub,
  SystemOperationsHub,
} from './modules/AdminHubs';

export interface AdminModuleConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  component: React.FC<any>;
  /** moduleToggle key in GlobalHotelSettings.moduleToggles (e.g. 'admin_user_security') */
  toggleKey: string;
}

/** Consolidated System Administration modules (13 top-level tabs). */
export const CORE_ADMIN_MODULES: AdminModuleConfig[] = [
  {
    id: 'executive_dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    component: AdminOverview,
    toggleKey: 'admin_executive_dashboard',
  },
  {
    id: 'tenant_property',
    label: 'Properties & Org',
    icon: Building2,
    component: TenantPropertyHub,
    toggleKey: 'admin_tenant_property',
  },
  {
    id: 'user_security',
    label: 'Users & Access',
    icon: Shield,
    component: UserManagementSecurity,
    toggleKey: 'admin_user_security',
  },
  {
    id: 'portal_management',
    label: 'Portals & Features',
    icon: Layers,
    component: PortalFeatureHub,
    toggleKey: 'admin_portal_management',
  },
  {
    id: 'master_data',
    label: 'Master Data',
    icon: Database,
    component: MasterData,
    toggleKey: 'admin_master_data',
  },
  {
    id: 'workflow_center',
    label: 'Rules & Workflows',
    icon: GitBranch,
    component: RulesWorkflowsHub,
    toggleKey: 'admin_workflow_center',
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: Mail,
    component: TemplatesModule,
    toggleKey: 'admin_templates',
  },
  {
    id: 'pos_management',
    label: 'Devices & Terminals',
    icon: Cpu,
    component: PosDevicesHub,
    toggleKey: 'admin_pos_management',
  },
  {
    id: 'rate_tax',
    label: 'Payment Gateways',
    icon: CreditCard,
    component: PaymentGatewayModule,
    toggleKey: 'admin_rate_tax',
  },
  {
    id: 'system_settings',
    label: 'System Settings',
    icon: Settings,
    component: GlobalSystemSettings,
    toggleKey: 'admin_system_settings',
  },
  {
    id: 'integration_hub',
    label: 'API Gateway',
    icon: Key,
    component: APIManagement,
    toggleKey: 'admin_integration_hub',
  },
  {
    id: 'monitoring_health',
    label: 'System & Operations',
    icon: Activity,
    component: SystemOperationsHub,
    toggleKey: 'admin_monitoring_health',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    component: AdminReports,
    toggleKey: 'admin_reports',
  },
];

/** Core admin modules visible under the current Platform Controls toggles. */
export function getVisibleAdminModules(moduleToggles: Record<string, boolean>): AdminModuleConfig[] {
  return CORE_ADMIN_MODULES.filter((m) => moduleToggles[m.toggleKey] !== false);
}

/** Build a fast lookup map: moduleId -> config */
const adminModuleMap: Record<string, AdminModuleConfig> = CORE_ADMIN_MODULES.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<string, AdminModuleConfig>
);

/** Legacy & consolidated aliases — preserves all existing URLs and deep links. */
export const adminModuleAliases: Record<string, string> = {
  // Properties & Org
  property_public_profile: 'tenant_property',
  organization_structure: 'tenant_property',
  property_structure: 'tenant_property',
  department_management: 'tenant_property',
  property_config: 'tenant_property',

  // Users & Access
  identity_authentication: 'user_security',
  system_admin: 'user_security',
  audit_logs: 'user_security',
  role_permissions: 'user_security',
  user_management: 'user_security',
  role_permission: 'user_security',
  security_center: 'user_security',
  audit_center: 'user_security',

  // Portals & Features
  feature_flag: 'portal_management',
  module_management: 'portal_management',
  platform_controls: 'portal_management',

  // Master Data
  masterdata: 'master_data',
  reference_data: 'master_data',

  // Rules & Workflows
  business_rules: 'workflow_center',
  rules_workflows: 'workflow_center',
  workflow_engine: 'workflow_center',
  workflow_instances: 'workflow_center',
  approval_matrix: 'workflow_center',

  // Templates
  notification_center: 'templates',
  document_template: 'templates',
  document_templates: 'templates',

  // POS & Devices
  device_management: 'pos_management',
  pos_setup: 'pos_management',

  // Billing & Tax
  payment_gateway: 'rate_tax',

  // System Settings
  global: 'system_settings',
  global_settings: 'system_settings',
  localization: 'system_settings',

  // Integrations & API
  api_gateway: 'integration_hub',
  channel_manager: 'integration_hub',
  integration: 'integration_hub',
  system_integration: 'integration_hub',

  // System & Operations
  system_health: 'monitoring_health',
  scheduler: 'monitoring_health',
  backup_recovery: 'monitoring_health',
  backup: 'monitoring_health',
  data_backups: 'monitoring_health',
  compliance: 'monitoring_health',
  licensing: 'monitoring_health',

  // Reports
  reports_analytics: 'reports',
};

/**
 * Resolve any module key (including legacy aliases) to a canonical config.
 * Falls back to the first core module if unknown.
 */
export function resolveAdminModule(moduleId?: string): AdminModuleConfig {
  if (!moduleId) return CORE_ADMIN_MODULES[0];
  const canonical = adminModuleAliases[moduleId] || moduleId;
  return adminModuleMap[canonical] || CORE_ADMIN_MODULES[0];
}
