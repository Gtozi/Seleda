/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Users, Briefcase, TrendingUp, Plus, Edit2 } from 'lucide-react';
import { Guest } from '../../types/erp';
import StatCard from '../../FrontOffice/StatCard';
import { SectionCard } from '../../FrontOffice/ui';
import { button } from '../../FrontOffice/brandTheme';

interface GuestsCategoryProps {
  guests: Guest[];
  filteredGuests: Guest[];
  onInspect: (guest: Guest) => void;
  onEdit: (guest: Guest) => void;
  onAddGuest: () => void;
}

export default function GuestsCategory({
  guests,
  filteredGuests,
  onInspect,
  onEdit,
  onAddGuest,
}: GuestsCategoryProps) {
  return (
    <div className="space-y-6">
      {/* Internal Dashboard metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Total Profiling Stacks" value={guests.length} icon={Users} tone="accent" />
        <StatCard title="VIP Flagged Accounts" value={guests.filter(g => g.status === 'VIP').length} icon={Briefcase} tone="warning" />
        <StatCard title="Total Loyalty Points" value={guests.reduce((acc, g) => acc + (g.loyaltyPoints || 0), 0)} icon={TrendingUp} tone="success" />
      </div>

      {/* Master Guests Profiler table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-50 dark:border-slate-850 flex justify-between items-center">
          <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">Operational Guest Directory ({filteredGuests.length})</h3>
          <button
            onClick={onAddGuest}
            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1 cursor-pointer"
          >
            <Plus size={12} /> Onboard Guest
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800 text-[9px] font-black text-slate-400 uppercase tracking-wider">
                <th className="px-6 py-3">Guest Profiler</th>
                <th className="px-6 py-3">Contact Channels</th>
                <th className="px-6 py-3">Nationality</th>
                <th className="px-6 py-3">Status Banner</th>
                <th className="px-6 py-3 font-mono">Loyalty Sum</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-850">
              {filteredGuests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 text-xs italic">
                    No guest profiler mapped to active memory query.
                  </td>
                </tr>
              ) : (
                filteredGuests.map((guest) => (
                  <tr
                    key={guest.id}
                    onClick={() => onInspect(guest)}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20 cursor-pointer group transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-2xs uppercase">
                          {guest.name.substring(0,2)}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">{guest.name}</span>
                          <span className="text-[8px] font-mono text-slate-400 uppercase">SYS_REF: {guest.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col text-[10px]">
                        <span className="text-slate-750 dark:text-slate-350">{guest.email}</span>
                        <span className="text-[8px] font-mono text-slate-400">{guest.phone}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-slate-650 dark:text-slate-350">{guest.nationality || 'Unspecified'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                        guest.status === 'VIP' ? 'bg-amber-100 text-amber-700' :
                        guest.status === 'Loyalty Member' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/10' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {guest.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-bold text-slate-500">
                      {guest.loyaltyPoints?.toLocaleString() || 0} pts
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(guest);
                          }}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-600 transition rounded-lg"
                        >
                          <Edit2 size={13} />
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
