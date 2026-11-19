/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { layout } from '../FrontOffice/brandTheme';

import HKDashboard from './HKDashboard';
import RoomBoardModule from './RoomBoardModule';
import TaskManagementModule from './TaskManagementModule';
import RoomInspectionsModule from './RoomInspectionsModule';
import StaffManagementModule from './StaffManagementModule';
import SupervisorConsoleModule from './SupervisorConsoleModule';
import LaundryModule from './LaundryModule';
import GuestAmenitiesModule from './GuestAmenitiesModule';
import MinibarOperationsModule from './MinibarOperationsModule';
import LostAndFoundModule from './LostAndFoundModule';
import GuestRequestsModule from './GuestRequestsModule';
import DeepCleaningModule from './DeepCleaningModule';
import PreventiveCleaningModule from './PreventiveCleaningModule';
import MaintenanceCoordinationModule from './MaintenanceCoordinationModule';
import HousekeepingInventoryModule from './HousekeepingInventoryModule';
import HKSupplyProcurementModule from './HKSupplyProcurementModule';
import CommunicationCenterModule from './CommunicationCenterModule';
import HKReportsModule from './HKReportsModule';
import ConfigurationModule from './ConfigurationModule';

/**
 * Housekeeping Portal tab ids — 19 modules per docs/Housekeeping Portal new.md
 * (§3). Room Cleaning (§7) and Public Area Cleaning (§8) have been
 * consolidated into Task Management (§6) as a unified master-detail interface.
 */
export type HKTab =
  | 'dashboard'
  | 'rooms'
  | 'tasks'
  | 'inspections'
  | 'staff'
  | 'supervisor'
  | 'laundry'
  | 'amenities'
  | 'minibar'
  | 'lostfound'
  | 'guest-requests'
  | 'deep-cleaning'
  | 'preventive-cleaning'
  | 'maintenance'
  | 'inventory'
  | 'supply-procurement'
  | 'communication'
  | 'reports'
  | 'configuration';

export type RoomCleaningStatus =
  | 'Vacant Clean'
  | 'Vacant Dirty'
  | 'Occupied Clean'
  | 'Occupied Dirty'
  | 'Inspected'
  | 'Ready'
  | 'Pickup'
  | 'Sleep-Out'
  | 'Do Not Disturb'
  | 'Out of Order'
  | 'Out of Service'
  | 'Maintenance Required';

export type TaskStatus = 'Pending' | 'In Progress' | 'Completed' | 'Verified';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface HKTask {
  id: string;
  type:
    | 'Checkout Cleaning'
    | 'Stayover Service'
    | 'VIP Preparation'
    | 'Turndown Service'
    | 'Early Arrival Preparation'
    | 'Deep Cleaning'
    | 'Preventive Cleaning'
    | 'Public Area Cleaning'
    | 'Special Cleaning'
    | 'Emergency Cleaning'
    | 'Biohazard Cleaning'
    | 'Room Refresh'
    | 'Guest Complaint Follow-up';
  category: 'Automatic' | 'Manual';
  location: string;
  assignedTo?: string;
  priority: TaskPriority;
  dueDate: string;
  status: TaskStatus;
  progress: number;
}

export interface LaundryItem {
  id: string;
  name: string;
  category: 'Guest' | 'Internal';
  serviceType?: 'Wash' | 'Dry Clean' | 'Iron' | 'Express Service';
  pieces: number;
  price?: number;
  status: 'Collected' | 'Washing' | 'Drying' | 'Ironing' | 'Ready' | 'Delivered';
  guestName?: string;
  roomNumber?: string;
  timestamp: string;
}

export default function HousekeepingPortal({ activeTab, onTabChange }: { activeTab: HKTab; onTabChange?: (tab: string) => void }) {
  const [searchParams] = useSearchParams();

  // Read URL parameters for deep-linking (module switch) — mirrors F&B portal
  useEffect(() => {
    const module = searchParams.get('module');
    if (module) {
      onTabChange?.(module);
    }
  }, [searchParams, onTabChange]);

  return (
    <div className={['accent-hk', layout.sectionStack, 'animate-fade-in'].join(' ')} id="modular-housekeeping-suite">
      <div className="min-h-[600px]">
        {activeTab === 'dashboard' && <HKDashboard />}
        {activeTab === 'rooms' && <RoomBoardModule />}
        {activeTab === 'tasks' && <TaskManagementModule />}
        {activeTab === 'inspections' && <RoomInspectionsModule />}
        {activeTab === 'staff' && <StaffManagementModule />}
        {activeTab === 'supervisor' && <SupervisorConsoleModule />}
        {activeTab === 'laundry' && <LaundryModule />}
        {activeTab === 'amenities' && <GuestAmenitiesModule />}
        {activeTab === 'minibar' && <MinibarOperationsModule />}
        {activeTab === 'lostfound' && <LostAndFoundModule />}
        {activeTab === 'guest-requests' && <GuestRequestsModule />}
        {activeTab === 'deep-cleaning' && <DeepCleaningModule />}
        {activeTab === 'preventive-cleaning' && <PreventiveCleaningModule />}
        {activeTab === 'maintenance' && <MaintenanceCoordinationModule />}
        {activeTab === 'inventory' && <HousekeepingInventoryModule />}
        {activeTab === 'supply-procurement' && <HKSupplyProcurementModule />}
        {activeTab === 'communication' && <CommunicationCenterModule />}
        {activeTab === 'reports' && <HKReportsModule />}
        {activeTab === 'configuration' && <ConfigurationModule />}
      </div>
    </div>
  );
}
