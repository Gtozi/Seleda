/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Home, AlertTriangle, FileCheck, Plus, Edit2, Trash2 } from 'lucide-react';
import { Room } from '../../types/erp';
import StatCard from '../../FrontOffice/StatCard';
import { SectionCard } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';

interface RoomsCategoryProps {
  rooms: Room[];
  filteredRooms: Room[];
  formatAmount: (amount: number) => string;
  onInspect: (room: Room) => void;
  onEdit: (room: Room) => void;
  onDelete: (roomId: string) => void;
  onAddRoom: () => void;
}

export default function RoomsCategory({
  rooms,
  filteredRooms,
  formatAmount,
  onInspect,
  onEdit,
  onDelete,
  onAddRoom,
}: RoomsCategoryProps) {
  return (
    <div className="space-y-6">
      {/* Internal Dashboard metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Registered Rooms" value={rooms.length} icon={Home} tone="accent" />
        <StatCard title="Out of Order Holds" value={rooms.filter(r => r.status === 'Out of Order').length} icon={AlertTriangle} tone="danger" />
        <StatCard title="Clean Vacant Ready" value={rooms.filter(r => r.status === 'Vacant Clean').length} icon={FileCheck} tone="success" />
      </div>

      {/* Properties List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-50 dark:border-slate-850 flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Registered Property Inventory ({filteredRooms.length})</h3>
          <button
            onClick={onAddRoom}
            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-xl text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 cursor-pointer"
          >
            <Plus size={12} /> Map New Room
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-6 py-3">Room Unit</th>
                <th className="px-6 py-3">Room Type</th>
                <th className="px-6 py-3">Level / Floor</th>
                <th className="px-6 py-3">Base Tariff</th>
                <th className="px-6 py-3">Active Status</th>
                <th className="px-6 py-3 text-right">Mappers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-850">
              {filteredRooms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 text-xs italic">
                    No physical room records matching query.
                  </td>
                </tr>
              ) : (
                filteredRooms.map((room) => (
                  <tr
                    key={room.id}
                    onClick={() => onInspect(room)}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20 cursor-pointer group transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/20 text-orange-600 flex items-center justify-center font-bold font-mono text-xs">{room.number}</div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">Suite-{room.id}</span>
                          <span className="text-[8px] font-bold text-slate-400">UID: #{room.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-slate-850 dark:text-slate-200">{room.type}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-slate-500 font-mono">Floor {room.floor}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-emerald-600 font-mono">{formatAmount(room.rate)}/night</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                        room.status.includes('Clean') ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/10' :
                        room.status.includes('Dirty') ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/10' :
                        'bg-rose-50 text-rose-600 dark:bg-rose-900/10'
                      }`}>
                        {room.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(room);
                          }}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-600 transition rounded-lg"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(room.id);
                          }}
                          className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition rounded-lg"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
