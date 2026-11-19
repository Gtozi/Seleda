
import React from 'react';
import EngineeringDashboard from './EngineeringDashboard';
import WorkOrderManagement from './WorkOrderManagement';
import PreventiveMaintenanceScheduler from './PreventiveMaintenanceScheduler';
import UtilitiesManagement from './UtilitiesManagement';
import StaffManagement from './StaffManagement';
import ComplianceModule from './ComplianceModule';
import RoomMaintenanceModule from './RoomMaintenanceModule';
import EngineeringReportsModule from './EngineeringReportsModule';
import WorkRequests from './WorkRequests';
import CorrectiveMaintenance from './CorrectiveMaintenance';
import EquipmentRegistry from './EquipmentRegistry';
import BuildingMaintenance from './BuildingMaintenance';
import EnergyManagement from './EnergyManagement';
import SparePartsInterface from './SparePartsInterface';
import SupplyProcurementModule from './SupplyProcurementModule';
import Inspections from './Inspections';
import CalibrationManagement from './CalibrationManagement';
import ProjectsRenovations from './ProjectsRenovations';
import CommunicationCenter from './CommunicationCenter';
import Configuration from './Configuration';

const EngineeringPortal: React.FC<{ activeTab?: string }> = ({ activeTab = 'dashboard' }) => {

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 animate-fade-in">
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'dashboard' && <EngineeringDashboard />}
        {activeTab === 'work-requests' && <WorkRequests />}
        {activeTab === 'workorders' && <WorkOrderManagement />}
        {activeTab === 'corrective-maintenance' && <CorrectiveMaintenance />}
        {activeTab === 'pm' && <PreventiveMaintenanceScheduler />}
        {activeTab === 'equipment-registry' && <EquipmentRegistry />}
        {activeTab === 'building-maintenance' && <BuildingMaintenance />}
        {activeTab === 'energy-management' && <EnergyManagement />}
        {activeTab === 'spare-parts' && <SparePartsInterface />}
        {activeTab === 'vendor-contractor' && <SupplyProcurementModule />}
        {activeTab === 'inspections' && <Inspections />}
        {activeTab === 'calibration' && <CalibrationManagement />}
        {activeTab === 'projects-renovations' && <ProjectsRenovations />}
        {activeTab === 'communication' && <CommunicationCenter />}
        {activeTab === 'configuration' && <Configuration />}
        {activeTab === 'rooms' && <RoomMaintenanceModule />}
        {activeTab === 'utilities' && <UtilitiesManagement />}
        {activeTab === 'staff' && <StaffManagement />}
        {activeTab === 'compliance' && <ComplianceModule />}
        {activeTab === 'reports' && <EngineeringReportsModule />}
      </div>
    </div>
  );
};

export default EngineeringPortal;
