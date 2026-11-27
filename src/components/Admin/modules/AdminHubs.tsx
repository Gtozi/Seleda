import React, { useState } from 'react';
import {
  Building2, Network, Globe, Layers, ToggleRight, ShieldCheck, GitBranch,
  Scale, ListChecks, CheckSquare, Store, Cpu, Monitor, Percent, CreditCard,
  Plug, Key, Radio, Activity, Calendar, Database, Shield, KeyRound,
} from 'lucide-react';
import { AdminSubTabBar } from '../shared/AdminSubTabBar';
import PropertyManager from '../PropertyManager';
import OrganizationHierarchyManager from '../OrganizationHierarchyManager';
import PropertyPublicProfile from './PropertyPublicProfile';
import PortalManagementLive from './PortalManagementLive';
import POSOutletManagement from '../POSOutletManagement';
import SystemIntegrationChannel from '../SystemIntegrationChannel';
import APIManagement from '../APIManagement';
import SystemHealthDashboard from '../SystemHealthDashboard';
import SchedulerManager from '../SchedulerManager';
import DataManagementBackups from '../DataManagementBackups';
import ComplianceCenter from '../ComplianceCenter';
import { WorkflowInstancesModule } from './CentralRulesUI';
import {
  DepartmentsModule,
  FeatureFlagsModule,
  BusinessRulesModule,
  WorkflowModule,
  ApprovalMatrixModule,
  PaymentGatewayModule,
  RateTaxModule,
  LicensingModule,
  ChannelManagerModule,
} from './ControlModules';
import { ResourceManager, type ResourceField } from '../shared/ResourceManager';

const deviceFields: ResourceField[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'deviceType', label: 'Type', default: 'terminal', placeholder: 'terminal, printer, kiosk…' },
  { key: 'location', label: 'Location' },
  { key: 'ipAddress', label: 'IP address' },
  { key: 'serialNumber', label: 'Serial number', table: false },
  { key: 'firmware', label: 'Firmware', table: false },
  { key: 'status', label: 'Status', type: 'select', default: 'offline', options: ['online', 'offline', 'maintenance', 'retired'].map(v => ({ value: v, label: v })) },
];

const posTerminalFields: ResourceField[] = [
  { key: 'outletId', label: 'Outlet', type: 'select', required: true, optionsUrl: '/api/pos/outlets', options: [], help: 'POS outlet this terminal belongs to.' },
  { key: 'deviceId', label: 'Device ID', required: true, placeholder: 'e.g. SN-2024-0017', help: 'Hardware serial or system-assigned unique ID.' },
  { key: 'terminalName', label: 'Terminal name', required: true, placeholder: 'Bar Terminal 1' },
  { key: 'terminalType', label: 'Type', type: 'select', default: 'standard', options: ['standard', 'kitchen_display', 'mobile', 'kiosk', 'self_service'].map(v => ({ value: v, label: v.replace(/_/g, ' ') })) },
  { key: 'hardwareModel', label: 'Hardware model', table: false },
  { key: 'ipAddress', label: 'IP address' },
  { key: 'printerStation', label: 'Printer station', table: false },
  { key: 'isActive', label: 'Active', type: 'boolean', toggle: true, default: true },
  { key: 'settings', label: 'Settings (JSON)', type: 'json', table: false },
];

export const TenantPropertyHub: React.FC = () => {
  const [tab, setTab] = useState<'properties' | 'org' | 'public' | 'departments'>('properties');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'properties', label: 'Tenant & Property', icon: <Building2 size={14} /> },
          { id: 'org', label: 'Organization Tree', icon: <Network size={14} /> },
          { id: 'public', label: 'Public Profile', icon: <Globe size={14} /> },
          { id: 'departments', label: 'Departments', icon: <Layers size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'properties' && <PropertyManager />}
      {tab === 'org' && <OrganizationHierarchyManager />}
      {tab === 'public' && <PropertyPublicProfile />}
      {tab === 'departments' && <DepartmentsModule />}
    </div>
  );
};

export const PortalFeatureHub: React.FC = () => {
  const [tab, setTab] = useState<'portals' | 'flags'>('portals');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'portals', label: 'Portal Management', icon: <ShieldCheck size={14} /> },
          { id: 'flags', label: 'Feature Flags', icon: <ToggleRight size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'portals' && <PortalManagementLive />}
      {tab === 'flags' && <FeatureFlagsModule />}
    </div>
  );
};

export const RulesWorkflowsHub: React.FC = () => {
  const [tab, setTab] = useState<'rules' | 'workflows' | 'instances' | 'approvals'>('rules');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'rules', label: 'Business Rules', icon: <Scale size={14} /> },
          { id: 'workflows', label: 'Workflows', icon: <GitBranch size={14} /> },
          { id: 'instances', label: 'Instances', icon: <ListChecks size={14} /> },
          { id: 'approvals', label: 'Approval Matrix', icon: <CheckSquare size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'rules' && <BusinessRulesModule />}
      {tab === 'workflows' && <WorkflowModule embedded />}
      {tab === 'instances' && <WorkflowInstancesModule embedded />}
      {tab === 'approvals' && <ApprovalMatrixModule embedded />}
    </div>
  );
};

export const PosDevicesHub: React.FC = () => {
  const [tab, setTab] = useState<'outlets' | 'devices' | 'terminals'>('outlets');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'outlets', label: 'POS Outlets', icon: <Store size={14} /> },
          { id: 'devices', label: 'Devices', icon: <Cpu size={14} /> },
          { id: 'terminals', label: 'POS Terminals', icon: <Monitor size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'outlets' && <POSOutletManagement />}
      {tab === 'devices' && (
        <ResourceManager
          embedded
          title="Device Management"
          description="Registry of terminals, printers, key encoders, and kiosks."
          resource="devices"
          itemLabel="device"
          fields={deviceFields}
          stats={items => [{ label: 'Devices', value: items.length }, { label: 'Online', value: items.filter(i => i.status === 'online').length }]}
        />
      )}
      {tab === 'terminals' && (
        <ResourceManager
          embedded
          title="POS Terminals"
          description="Registered POS terminals mapped to outlets."
          resource="pos-terminals"
          itemLabel="terminal"
          fields={posTerminalFields}
          stats={items => [{ label: 'Terminals', value: items.length }, { label: 'Active', value: items.filter(i => i.isActive).length }]}
        />
      )}
    </div>
  );
};

export const BillingTaxHub: React.FC = () => {
  const [tab, setTab] = useState<'tax' | 'gateways'>('tax');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'tax', label: 'Rate & Tax', icon: <Percent size={14} /> },
          { id: 'gateways', label: 'Payment Gateways', icon: <CreditCard size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'tax' && <RateTaxModule />}
      {tab === 'gateways' && <PaymentGatewayModule />}
    </div>
  );
};

export const IntegrationsHub: React.FC = () => {
  const [tab, setTab] = useState<'hub' | 'api' | 'channels'>('hub');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'hub', label: 'Integration Hub', icon: <Plug size={14} /> },
          { id: 'api', label: 'API Gateway', icon: <Key size={14} /> },
          { id: 'channels', label: 'Channel Manager', icon: <Radio size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'hub' && <SystemIntegrationChannel />}
      {tab === 'api' && <APIManagement />}
      {tab === 'channels' && <ChannelManagerModule />}
    </div>
  );
};

export const SystemOperationsHub: React.FC = () => {
  const [tab, setTab] = useState<'health' | 'scheduler' | 'backups' | 'compliance' | 'licensing'>('health');
  return (
    <div className="space-y-6 animate-fade-in">
      <AdminSubTabBar
        tabs={[
          { id: 'health', label: 'Monitoring & Health', icon: <Activity size={14} /> },
          { id: 'scheduler', label: 'Scheduler', icon: <Calendar size={14} /> },
          { id: 'backups', label: 'Backup & Recovery', icon: <Database size={14} /> },
          { id: 'compliance', label: 'Compliance', icon: <Shield size={14} /> },
          { id: 'licensing', label: 'Licensing', icon: <KeyRound size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'health' && <SystemHealthDashboard />}
      {tab === 'scheduler' && <SchedulerManager />}
      {tab === 'backups' && <DataManagementBackups />}
      {tab === 'compliance' && <ComplianceCenter />}
      {tab === 'licensing' && <LicensingModule />}
    </div>
  );
};
