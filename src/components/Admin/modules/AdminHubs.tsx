import React, { useEffect, useState } from 'react';
import {
  Building2, Network, Layers, ToggleRight, ShieldCheck, GitBranch,
  Scale, ListChecks, CheckSquare, Cpu, Monitor,
  Activity, Calendar, Database, Shield, KeyRound,
} from 'lucide-react';
import { AdminSubTabBar } from '../shared/AdminSubTabBar';
import { PageHeader } from '../../FrontOffice/ui';
import StatCard from '../../FrontOffice/StatCard';
import { layout } from '../../FrontOffice/brandTheme';
import { adminAuthHeaders } from '../shared/ResourceManager';
import PropertyManager from '../PropertyManager';
import OrganizationHierarchyManager from '../OrganizationHierarchyManager';
import PortalManagementLive from './PortalManagementLive';
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
  LicensingModule,
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

function useSyncedTab<T extends string>(activeModule: string | undefined, mapFn: (m?: string) => T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [tab, setTab] = useState<T>(() => mapFn(activeModule));
  useEffect(() => {
    if (activeModule) setTab(mapFn(activeModule));
  }, [activeModule]);
  return [tab, setTab];
}

function useAdminOverviewCounts() {
  const [counts, setCounts] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/control/overview', { headers: adminAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j) setCounts(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return counts;
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));

export const TenantPropertyHub: React.FC<{ activeModule?: string }> = ({ activeModule }) => {
  const counts = useAdminOverviewCounts();
  const [tab, setTab] = useSyncedTab<'properties' | 'org' | 'departments'>(activeModule, m => {
    if (m === 'organization_structure' || m === 'property_structure') return 'org';
    if (m === 'department_management') return 'departments';
    return 'properties';
  });
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Properties & Organization"
        subtitle="Manage organizations, properties, and departments"
        icon={Building2}
      />
      <div className={layout.kpiGrid}>
        <StatCard title="Organizations" value={n(counts?.organizations)} icon={Network} tone="accent" />
        <StatCard title="Properties" value={n(counts?.properties)} icon={Building2} tone="info" />
        <StatCard title="Departments" value={n(counts?.departments)} icon={Layers} tone="success" />
      </div>
      <AdminSubTabBar
        tabs={[
          { id: 'properties', label: 'Tenant & Property', icon: <Building2 size={14} /> },
          { id: 'org', label: 'Organization Tree', icon: <Network size={14} /> },
          { id: 'departments', label: 'Departments', icon: <Layers size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'properties' && <PropertyManager embedded />}
      {tab === 'org' && <OrganizationHierarchyManager embedded />}
      {tab === 'departments' && <DepartmentsModule embedded />}
    </div>
  );
};

export const PortalFeatureHub: React.FC<{ activeModule?: string }> = ({ activeModule }) => {
  const [tab, setTab] = useSyncedTab<'portals' | 'flags'>(activeModule, m => (m === 'feature_flag' ? 'flags' : 'portals'));
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Portals & Features"
        subtitle="Configure portal availability, governance approvals, and feature rollouts"
        icon={ShieldCheck}
      />
      <AdminSubTabBar
        tabs={[
          { id: 'portals', label: 'Portal Management', icon: <ShieldCheck size={14} /> },
          { id: 'flags', label: 'Feature Flags', icon: <ToggleRight size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === 'portals' && <PortalManagementLive embedded />}
      {tab === 'flags' && <FeatureFlagsModule embedded />}
    </div>
  );
};

export const RulesWorkflowsHub: React.FC<{ activeModule?: string }> = ({ activeModule }) => {
  const [tab, setTab] = useSyncedTab<'rules' | 'workflows' | 'instances' | 'approvals'>(activeModule, m => {
    if (m === 'workflow_instances') return 'instances';
    if (m === 'approval_matrix') return 'approvals';
    if (m === 'workflow_engine' || m === 'workflow_center') return 'workflows';
    return 'rules';
  });
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Rules & Workflows"
        subtitle="Central business rules, multi-step workflows, running instances, and approval matrix"
        icon={GitBranch}
      />
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
      {tab === 'rules' && <BusinessRulesModule embedded />}
      {tab === 'workflows' && <WorkflowModule embedded />}
      {tab === 'instances' && <WorkflowInstancesModule embedded />}
      {tab === 'approvals' && <ApprovalMatrixModule embedded />}
    </div>
  );
};

export const PosDevicesHub: React.FC<{ activeModule?: string }> = ({ activeModule }) => {
  const [tab, setTab] = useSyncedTab<'devices' | 'terminals'>(activeModule, m => (m === 'pos_management' ? 'terminals' : 'devices'));
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="Devices & Terminals"
        subtitle="Manage hardware devices, encoders, kiosks, and registered POS terminals"
        icon={Cpu}
      />
      <AdminSubTabBar
        tabs={[
          { id: 'devices', label: 'Devices', icon: <Cpu size={14} /> },
          { id: 'terminals', label: 'POS Terminals', icon: <Monitor size={14} /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
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





export const SystemOperationsHub: React.FC<{ activeModule?: string }> = ({ activeModule }) => {
  const [tab, setTab] = useSyncedTab<'health' | 'scheduler' | 'backups' | 'compliance' | 'licensing'>(activeModule, m => {
    if (m === 'scheduler') return 'scheduler';
    if (m === 'backup_recovery' || m === 'backup' || m === 'data_backups') return 'backups';
    if (m === 'compliance') return 'compliance';
    if (m === 'licensing') return 'licensing';
    return 'health';
  });
  return (
    <div className={`${layout.sectionStack} animate-fade-in`}>
      <PageHeader
        title="System & Operations"
        subtitle="System health monitoring, scheduled jobs, backups, GDPR compliance, and licensing"
        icon={Activity}
      />
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
      {tab === 'health' && <SystemHealthDashboard embedded />}
      {tab === 'scheduler' && <SchedulerManager embedded />}
      {tab === 'backups' && <DataManagementBackups embedded />}
      {tab === 'compliance' && <ComplianceCenter embedded />}
      {tab === 'licensing' && <LicensingModule embedded />}
    </div>
  );
};
