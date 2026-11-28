/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sliders, Bed, Warehouse, MapPin, Database } from 'lucide-react';
import RoomTypeManager, { RoomTypeData } from './RoomTypeManager';
import AttributeManager from './AttributeManager';

interface AttributesCategoryProps {
  roomTypesDetailed: RoomTypeData[];
  roomFeatures: string[];
  guestStatuses: string[];
  inventoryCategories: string[];
  inventoryLocations: string[];
  inventoryUnits: string[];
  departments: string[];
  floors: string[];
  onGlobalSettingsChange: (name: string, description: string, type: string, changes: any) => void;
}

export default function AttributesCategory({
  roomTypesDetailed,
  roomFeatures,
  guestStatuses,
  inventoryCategories,
  inventoryLocations,
  inventoryUnits,
  departments,
  floors,
  onGlobalSettingsChange,
}: AttributesCategoryProps) {
  return (
    <div className="max-w-6xl mx-auto animate-fade-in space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 shadow-sm space-y-10">
        <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-850 pb-6">
          <div>
            <h3 className="text-lg font-sans font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2 mb-1">
              <Sliders size={20} className="text-amber-500" />
              Registry Attribute Definitions
            </h3>
            <p className="text-xs text-slate-400">Manage global categorizations, status mappings and unit definitions across the database.</p>
          </div>
        </div>

        {/* Property Structure */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/20 rounded-lg flex items-center justify-center">
              <MapPin size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Property Structure</h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Room types & features are managed in Front Office / Revenue; inventory categories, locations, and units are managed in Inventory.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AttributeManager
              title="Property Depts"
              items={departments || []}
              onUpdate={(items) => onGlobalSettingsChange('Property Departments', `Update departments: ${items.join(', ') || 'none'}`, 'global-setting', { departments: items })}
            />
            <AttributeManager
              title="Floor Labels"
              items={floors || []}
              onUpdate={(items) => onGlobalSettingsChange('Floor Labels', `Update floor labels: ${items.join(', ') || 'none'}`, 'global-setting', { floors: items })}
            />
          </div>
        </div>
      </div>

      <div className="p-8 bg-amber-500 rounded-[32px] text-slate-900 flex items-center justify-between shadow-2xl relative overflow-hidden">
        <div className="absolute left-0 top-0 p-8 opacity-10"><Database size={120} /></div>
        <div className="relative z-10 space-y-2">
          <h4 className="text-lg font-bold uppercase tracking-widest">Metadata Governance</h4>
          <p className="text-sm opacity-75 max-w-lg leading-relaxed">Changes to these attributes propagate globally. Modification of critical status mappings may require administrative re-indexing.</p>
        </div>
        <button className="px-8 py-4 bg-slate-950 text-white rounded-2xl font-bold text-[11px] uppercase tracking-widest transition hover:scale-105 shadow-xl shadow-black/20 relative z-10 cursor-pointer">
          Registry Audit Logs
        </button>
      </div>
    </div>
  );
}
