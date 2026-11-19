/**
 * Hotel Operations Portal (HOP)
 * The operational command center of the hotel
 * Provides real-time visibility into every department, coordinates cross-functional activities,
 * manages operational approvals, oversees service quality, and enables hotel leadership to make timely operational decisions
 */

import React, { useState } from 'react';

// Import all modules
import ExecutiveOperationsDashboard from './modules/ExecutiveOperationsDashboard';
import OperationsCommandCenter from './modules/OperationsCommandCenter';
import DailyBriefing from './modules/DailyBriefing';
import MorningMeetingDashboard from './modules/MorningMeetingDashboard';
import ManagerApprovalCenter from './modules/ManagerApprovalCenter';
import CrossDepartmentTaskCenter from './modules/CrossDepartmentTaskCenter';
import DutyManagerWorkspace from './modules/DutyManagerWorkspace';
import OperationalCalendar from './modules/OperationalCalendar';
import VIPGuestManagement from './modules/VIPGuestManagement';
import GuestRecovery from './modules/GuestRecovery';
import ServiceQualityManagement from './modules/ServiceQualityManagement';
import RoomOperationsOverview from './modules/RoomOperationsOverview';
import OccupancyForecastMonitor from './modules/OccupancyForecastMonitor';
import EventGroupCoordination from './modules/EventGroupCoordination';
import EmergencyCoordination from './modules/EmergencyCoordination';
import OperationalCommunicationCenter from './modules/OperationalCommunicationCenter';
import EscalationCenter from './modules/EscalationCenter';
import SOPComplianceMonitoring from './modules/SOPComplianceMonitoring';
import ExecutiveChecklists from './modules/ExecutiveChecklists';
import DailyFlashReports from './modules/DailyFlashReports';
import Reports from './modules/Reports';
import DepartmentRequisitionForm from '../Inventory/DepartmentRequisitionForm';
import Configuration from './modules/Configuration';

type OperationsView = 
  | 'executive-dashboard'
  | 'command-center'
  | 'daily-briefing'
  | 'morning-meeting'
  | 'approvals'
  | 'cross-department-tasks'
  | 'duty-manager'
  | 'calendar'
  | 'vip-management'
  | 'guest-recovery'
  | 'service-quality'
  | 'room-operations'
  | 'occupancy-forecast'
  | 'event-coordination'
  | 'emergency'
  | 'communication'
  | 'escalations'
  | 'sop-compliance'
  | 'executive-checklists'
  | 'flash-reports'
  | 'requisitions'
  | 'reports'
  | 'configuration';

interface HotelOperationsPortalProps {
  embedded?: boolean;
  forcedView?: OperationsView;
  activeTab?: OperationsView;
  onTabChange?: (tab: OperationsView) => void;
}

const HotelOperationsPortal: React.FC<HotelOperationsPortalProps> = ({
  embedded = false,
  forcedView,
  activeTab
}) => {
  // Phase 4: prefer activeTab (URL-driven) over forcedView, fall back to default
  const [internalActiveView] = useState<OperationsView>(forcedView || 'executive-dashboard');
  const activeView = activeTab ?? internalActiveView;

  // Render active module
  const renderActiveModule = () => {
    switch (activeView) {
      case 'executive-dashboard':
        return <ExecutiveOperationsDashboard />;
      case 'command-center':
        return <OperationsCommandCenter />;
      case 'daily-briefing':
        return <DailyBriefing />;
      case 'morning-meeting':
        return <MorningMeetingDashboard />;
      case 'approvals':
        return <ManagerApprovalCenter />;
      case 'cross-department-tasks':
        return <CrossDepartmentTaskCenter />;
      case 'duty-manager':
        return <DutyManagerWorkspace />;
      case 'calendar':
        return <OperationalCalendar />;
      case 'vip-management':
        return <VIPGuestManagement />;
      case 'guest-recovery':
        return <GuestRecovery />;
      case 'service-quality':
        return <ServiceQualityManagement />;
      case 'room-operations':
        return <RoomOperationsOverview />;
      case 'occupancy-forecast':
        return <OccupancyForecastMonitor />;
      case 'event-coordination':
        return <EventGroupCoordination />;
      case 'emergency':
        return <EmergencyCoordination />;
      case 'communication':
        return <OperationalCommunicationCenter />;
      case 'escalations':
        return <EscalationCenter />;
      case 'sop-compliance':
        return <SOPComplianceMonitoring />;
      case 'executive-checklists':
        return <ExecutiveChecklists />;
      case 'flash-reports':
        return <DailyFlashReports />;
      case 'requisitions':
        return <DepartmentRequisitionForm department="Operations" />;
      case 'reports':
        return <Reports />;
      case 'configuration':
        return <Configuration />;
      default:
        return <ExecutiveOperationsDashboard />;
    }
  };

  // If embedded, just render the module without navigation
  if (embedded) {
    return (
      <div className="w-full h-full">
        {renderActiveModule()}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      {/* Main Content Area — side nav is rendered globally by App.tsx */}
      <main className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          {renderActiveModule()}
        </div>
      </main>
    </div>
  );
};

export default HotelOperationsPortal;