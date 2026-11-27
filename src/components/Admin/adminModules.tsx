/**
 * Admin Module Registry
 * Single source of truth for all System Administration modules.
 * Used by App.tsx (tab bar) and AdminPortal.tsx (content router).
 * Based on System Administration Portal Architecture v1.0
 */

import React from 'react';

// Placeholder imports for new modules - will be implemented
import PropertyPublicProfile from './modules/PropertyPublicProfile';

import AdminOverview from './modules/AdminOverview';
import AdminReports from './modules/AdminReports';
import PortalManagementLive from './modules/PortalManagementLive';
import OrganizationHierarchyManager from './OrganizationHierarchyManager';
import { DepartmentsModule, FeatureFlagsModule, BusinessRulesModule, TemplatesModule, PaymentGatewayModule, DeviceModule, RateTaxModule, LicensingModule, IdentityProvidersModule, ChannelManagerModule, WorkflowCenterModule } from './modules/ControlModules';

// Standalone module components
import UserManagementSecurity from './UserManagementSecurity';
import SystemIntegrationChannel from './SystemIntegrationChannel';
import GlobalSystemSettings from './GlobalSystemSettings';
import DataManagementBackups from './DataManagementBackups';
import MasterData from './MasterData';
import SystemHealthDashboard from './SystemHealthDashboard';
import POSOutletManagement from './POSOutletManagement';
import PropertyManager from './PropertyManager';
import SchedulerManager from './SchedulerManager';
import ComplianceCenter from './ComplianceCenter';
import APIManagement from './APIManagement';


export interface AdminModuleConfig {
  id: string;
  label: string;
  component: React.FC<any>;
  /** moduleToggle key in GlobalHotelSettings.moduleToggles (e.g. 'admin_user_security') */
  toggleKey: string;
}

/** Core system admin modules — organized into 11 consolidated sections.
 *  Based on System Administration Portal Architecture v1.0
 *  This is the single source of truth for admin navigation. */
export const CORE_ADMIN_MODULES: AdminModuleConfig[] = [
  // ── Executive Dashboard ──
  {
    id: 'executive_dashboard',
    label: 'Executive Dashboard',
    component: AdminOverview,
    toggleKey: 'admin_executive_dashboard',
  },

  // ── Tenant & Property Management ──
  {
    id: 'tenant_property',
    label: 'Tenant & Property',
    component: PropertyManager,
    toggleKey: 'admin_tenant_property',
  },
  {
    id: 'property_public_profile',
    label: 'Property Public Profile',
    component: PropertyPublicProfile,
    toggleKey: 'admin_property_public_profile',
  },

  // ── Organization Structure ──
  {
    id: 'organization_structure',
    label: 'Organization Structure',
    component: OrganizationHierarchyManager,
    toggleKey: 'admin_organization_structure',
  },

  // ── Identity & Access ──
  {
    id: 'user_security',
    label: 'User Management & Security',
    component: UserManagementSecurity,
    toggleKey: 'admin_user_security',
  },
  {
    id: 'identity_authentication',
    label: 'Identity & Authentication',
    component: IdentityProvidersModule,
    toggleKey: 'admin_identity_authentication',
  },
  {
    id: 'department_management',
    label: 'Department Management',
    component: DepartmentsModule,
    toggleKey: 'admin_department_management',
  },

  // ── Configuration ──
  {
    id: 'portal_management',
    label: 'Portal Management',
    component: PortalManagementLive,
    toggleKey: 'admin_portal_management',
  },
  {
    id: 'feature_flag',
    label: 'Feature Flags',
    component: FeatureFlagsModule,
    toggleKey: 'admin_feature_flag',
  },
  {
    id: 'master_data',
    label: 'Master Data',
    component: MasterData,
    toggleKey: 'admin_master_data',
  },
  {
    id: 'business_rules',
    label: 'Business Rules',
    component: BusinessRulesModule,
    toggleKey: 'admin_business_rules',
  },
  {
    id: 'templates',
    label: 'Templates & Notifications',
    component: TemplatesModule,
    toggleKey: 'admin_templates',
  },
  {
    id: 'payment_gateway',
    label: 'Payment Gateway',
    component: PaymentGatewayModule,
    toggleKey: 'admin_payment_gateway',
  },
  {
    id: 'device_management',
    label: 'Device Management',
    component: DeviceModule,
    toggleKey: 'admin_device_management',
  },
  {
    id: 'pos_management',
    label: 'POS Management',
    component: POSOutletManagement,
    toggleKey: 'admin_pos_management',
  },
  {
    id: 'channel_manager',
    label: 'Channel Manager',
    component: ChannelManagerModule,
    toggleKey: 'admin_channel_manager',
  },
  {
    id: 'rate_tax',
    label: 'Rate & Tax',
    component: RateTaxModule,
    toggleKey: 'admin_rate_tax',
  },
  {
    id: 'system_settings',
    label: 'System Settings',
    component: GlobalSystemSettings,
    toggleKey: 'admin_system_settings',
  },

  // ── Users & Roles ──
  {
    id: 'workflow_center',
    label: 'Workflows',
    component: WorkflowCenterModule,
    toggleKey: 'admin_workflow_center',
  },

  // ── Operations ──
  {
    id: 'monitoring_health',
    label: 'Monitoring & Health',
    component: SystemHealthDashboard,
    toggleKey: 'admin_monitoring_health',
  },
  {
    id: 'backup_recovery',
    label: 'Backup & Recovery',
    component: DataManagementBackups,
    toggleKey: 'admin_backup_recovery',
  },
  {
    id: 'licensing',
    label: 'Licensing',
    component: LicensingModule,
    toggleKey: 'admin_licensing',
  },

  {
    id: 'scheduler',
    label: 'Scheduler',
    component: SchedulerManager,
    toggleKey: 'admin_scheduler',
  },
  {
    id: 'compliance',
    label: 'Compliance Center',
    component: ComplianceCenter,
    toggleKey: 'admin_compliance',
  },

  // ── Integrations ──
  {
    id: 'integration_hub',
    label: 'Integration Hub',
    component: SystemIntegrationChannel,
    toggleKey: 'admin_integration_hub',
  },
  {
    id: 'api_gateway',
    label: 'API Gateway',
    component: APIManagement,
    toggleKey: 'admin_api_gateway',
  },

  // ── Reports ──
  {
    id: 'reports',
    label: 'Reports',
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

/** Legacy aliases for old module names */
export const adminModuleAliases: Record<string, string> = {
  system_admin: 'user_security',
  property_structure: 'organization_structure',
  masterdata: 'master_data',
  reference_data: 'master_data',
  backup: 'backup_recovery',
  data_backups: 'backup_recovery',
  integration: 'integration_hub',
  system_integration: 'integration_hub',
  global: 'system_settings',
  global_settings: 'system_settings',
  system_health: 'monitoring_health',
  pos_setup: 'pos_management',
  audit_logs: 'user_security',
  property_config: 'tenant_property',
  role_permissions: 'user_security',
  reports_analytics: 'reports',
  module_management: 'portal_management',
  user_management: 'user_security',
  role_permission: 'user_security',
  security_center: 'user_security',
  audit_center: 'user_security',
  notification_center: 'templates',
  document_template: 'templates',
  document_templates: 'templates',
  localization: 'system_settings',
  platform_controls: 'portal_management',
  workflow_engine: 'workflow_center',
  workflow_instances: 'workflow_center',
  approval_matrix: 'workflow_center',
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
