/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Database,
  Home,
  Users,
  ShoppingCart,
  DollarSign,
  Search,
  Plus,
  MapPin,
  X,
  Check,
  Trash2,
  Sliders
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useERP } from '../../context/ERPContext';
import { ModalSystem } from '../Shared/ModalSystem';
import { RoomType, RoomStatus } from '../../types/erp';
import RoomsCategory from './MasterData/RoomsCategory';
import InfrastructureCategory from './MasterData/InfrastructureCategory';
import AttributesCategory from './MasterData/AttributesCategory';
import StatCard from '../FrontOffice/StatCard';
import { PageHeader } from '../FrontOffice/ui';
import { button, layout } from '../FrontOffice/brandTheme';
import { AdminSubTabBar } from './shared/AdminSubTabBar';

export default function MasterData() {
  const {
    rooms,
    roomTypes,
    addRoom,
    updateRoom,
    deleteRoom,
    guests,
    inventoryItems,
    chartOfAccounts,
    formatAmount,
    globalHotelSettings,
    submitGlobalSettingsChange
  } = useERP();

  const [category, setCategory] = useState<'rooms' | 'infrastructure' | 'attributes'>('rooms');

  const CATEGORY_TABS = [
    { id: 'rooms' as const, label: 'Rooms & Properties', icon: Home },
    { id: 'infrastructure' as const, label: 'Property Infrastructure', icon: MapPin },
    { id: 'attributes' as const, label: 'Registry Attributes', icon: Sliders },
  ];
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal configurations
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [inspectItem, setInspectItem] = useState<any | null>(null);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Success indicator helper
  const triggerSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleUpdateItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;

    if (category === 'rooms') {
      updateRoom(editItem.id, editItem);
      triggerSuccess(`Room ${editItem.number} configuration synchronized.`);
    }
    
    setShowEditModal(false);
    setEditItem(null);
  };

  // 1. Rooms Add State
  const [roomForm, setRoomForm] = useState({
    number: '',
    type: 'Double' as RoomType,
    roomTypeId: '' as string,
    floor: 1,
    rate: 150,
    status: 'Vacant Clean' as RoomStatus,
    features: [] as string[]
  });
  const availableFeatures = globalHotelSettings.roomFeatures || ['Wifi', 'TV', 'Desk', 'Mini-bar', 'AC', 'Ocean View', 'Garden View', 'Safe', 'Jaccuzi', 'Coffee machine', 'Private Terrace'];

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomForm.number.trim()) return;
    addRoom({
      number: roomForm.number,
      type: roomForm.type,
      roomTypeId: roomForm.roomTypeId || undefined,
      floor: Number(roomForm.floor) || 1,
      status: roomForm.status,
      rate: Number(roomForm.rate) || 100,
      features: roomForm.features
    });
    setRoomForm({ number: '', type: 'Double', roomTypeId: '', floor: 1, rate: 150, status: 'Vacant Clean', features: [] });
    setShowAddModal(false);
    triggerSuccess(`Room ${roomForm.number} created successfully.`);
  };

  // Search filtering
  const filteredRooms = rooms.filter(r =>
    r.number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in" id="master-data-module">
      
      {/* Alert banner */}
      <AnimatePresence>
        {successMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-emerald-500 text-white px-6 py-4 rounded-2xl shadow-lg flex items-center justify-between text-xs font-bold leading-normal tracking-wide"
          >
            <div className="flex items-center gap-2">
              <Check size={16} />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="opacity-85 hover:opacity-100">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <PageHeader
        title="Master Data Repositories"
        subtitle="Global system registries for rooms, guests, inventory, finance, infrastructure, and attributes"
        icon={Database}
        actions={
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${category}...`}
                className="pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)] w-64"
              />
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className={button.primary}
            >
              <Plus size={16} /> Add new entry
            </button>
          </>
        }
      />

      {/* KPI Cards */}
      <div className={layout.kpiGrid}>
        <StatCard title="Rooms" value={rooms.length} icon={Home} tone="accent" />
        <StatCard title="Guests" value={guests.length} icon={Users} tone="info" />
        <StatCard title="Inventory Items" value={inventoryItems.length} icon={ShoppingCart} tone="success" />
        <StatCard title="Accounts" value={chartOfAccounts.length} icon={DollarSign} tone="warning" />
      </div>

      {/* Category Tabs */}
      <AdminSubTabBar
        tabs={CATEGORY_TABS.map(t => ({ id: t.id, label: t.label, icon: <t.icon size={14} /> }))}
        activeTab={category}
        onChange={(id) => {
          setCategory(id);
          setSearchQuery('');
          setInspectItem(null);
        }}
      />

      {/* Dynamic Content Panel */}
      <div className="space-y-6">
           
           {/* ROOMS CATEGORY */}
           {category === 'rooms' && (
             <RoomsCategory
               rooms={rooms}
               filteredRooms={filteredRooms}
               formatAmount={formatAmount}
               onInspect={setInspectItem}
               onEdit={(room) => { setEditItem(room); setShowEditModal(true); }}
               onDelete={(roomId) => { deleteRoom(roomId); }}
               onAddRoom={() => { setCategory('rooms'); setShowAddModal(true); }}
             />
           )}

           {/* INFRASTRUCTURE CATEGORY */}
            {category === 'infrastructure' && (
              <InfrastructureCategory
                floors={globalHotelSettings.floors}
                departments={globalHotelSettings.departments}
              />
            )}

           {/* REGISTRY ATTRIBUTES CATEGORY */}
           {category === 'attributes' && (
             <AttributesCategory
               roomTypesDetailed={globalHotelSettings.roomTypesDetailed || []}
               roomFeatures={globalHotelSettings.roomFeatures || []}
               guestStatuses={globalHotelSettings.guestStatuses || []}
               inventoryCategories={globalHotelSettings.inventoryCategories || []}
               inventoryLocations={globalHotelSettings.inventoryLocations || []}
               inventoryUnits={globalHotelSettings.inventoryUnits || []}
               departments={globalHotelSettings.departments || []}
               floors={globalHotelSettings.floors || []}
               onGlobalSettingsChange={submitGlobalSettingsChange}
             />
           )}
      </div>

      {/* INSPECT DETAIL MODAL */}
      <ModalSystem
        isOpen={!!inspectItem}
        onClose={() => setInspectItem(null)}
        title={`Unit Property: Room ${inspectItem?.number}`}
        subtitle="SYS_MASTER_METADATA"
        variant="info"
        size="lg"
        showFooter={false}
      >
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {!inspectItem && (
                  <div className="text-center text-slate-400 py-8">No item selected.</div>
                )}
                {inspectItem && category === 'rooms' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-slate-55 dark:bg-slate-950 rounded-xl space-y-1">
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-widest block font-mono">Room Type Code</span>
                        <strong className="text-xs text-slate-900 dark:text-white block uppercase">{inspectItem.type}</strong>
                      </div>
                      <div className="p-3 bg-slate-55 dark:bg-slate-950 rounded-xl space-y-1">
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-widest block font-mono">Nightly Rate mapping</span>
                        <strong className="text-xs text-slate-900 dark:text-white block font-semibold">{formatAmount(inspectItem.rate)}</strong>
                      </div>
                      <div className="p-3 bg-slate-55 dark:bg-slate-950 rounded-xl space-y-1">
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-widest block font-mono">Floor Registry</span>
                        <strong className="text-xs text-slate-900 dark:text-white block font-mono">Level {inspectItem.floor}</strong>
                      </div>
                      <div className="p-3 bg-slate-55 dark:bg-slate-950 rounded-xl space-y-1">
                        <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-widest block font-mono">Current Status Code</span>
                        <strong className="text-xs text-slate-900 dark:text-white block uppercase">{inspectItem.status}</strong>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[8.5px] font-black text-slate-400 uppercase tracking-widest block font-mono ml-1">Amenities & In-Room Features</span>
                      <div className="flex flex-wrap gap-1.5 p-3.5 bg-slate-50 dark:bg-slate-950 border dark:border-slate-850 rounded-2xl">
                        {inspectItem.features?.length === 0 ? (
                          <span className="text-[10px] text-slate-400 italic">No special facilities assigned.</span>
                        ) : (
                          inspectItem.features?.map((f: string) => (
                            <span key={f} className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-sm uppercase tracking-wide">
                              {f}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4">
                      <button 
                        onClick={() => {
                          setEditItem(inspectItem);
                          setShowEditModal(true);
                          setInspectItem(null);
                        }}
                        className="flex-1 py-3.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest text-center cursor-pointer hover:bg-indigo-700 transition"
                      >
                        Modify room registry
                      </button>
                      <button 
                        onClick={() => {
                          if (confirm(`Do you wish to delete Room ${inspectItem.number}? This is permanent.`)) {
                            deleteRoom(inspectItem.id);
                            setInspectItem(null);
                            triggerSuccess(`Room ${inspectItem.number} deleted permanently.`);
                          }
                        }}
                        className="p-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl flex items-center justify-center cursor-pointer transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )}

              </div>
      </ModalSystem>

      {/* CREATE NEW MASTER ENTRY MODAL */}
      <ModalSystem
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Map New Property Room"
        subtitle="Mapped Entry Creator"
        variant="form"
        size="lg"
        showFooter={false}
      >
              {/* ROOMS FORM */}
              {category === 'rooms' && (
                <form onSubmit={handleCreateRoom} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Room Number ID</label>
                      <input 
                        required
                        type="text"
                        value={roomForm.number}
                        onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })}
                        placeholder="e.g. 504"
                        className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-semibold outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-slate-900 dark:text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Base Nightly Tariff (USD)</label>
                      <input 
                        required
                        type="number"
                        value={roomForm.rate}
                        onChange={(e) => setRoomForm({ ...roomForm, rate: Number(e.target.value) || 0 })}
                        placeholder="e.g. 200"
                        className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-semibold outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Floor Level</label>
                      <input
                        required
                        type="number"
                        value={roomForm.floor}
                        onChange={(e) => setRoomForm({ ...roomForm, floor: Number(e.target.value) || 1 })}
                        placeholder="1"
                        className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-semibold outline-none focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Room Configuration Category</label>
                      <select
                        value={roomForm.type}
                        onChange={(e) => {
                          const selectedType = e.target.value;
                          const selectedRoomType = roomTypes.find(rt => rt.name === selectedType);
                          setRoomForm({ 
                            ...roomForm, 
                            type: selectedType as RoomType,
                            roomTypeId: selectedRoomType?.id || '',
                            rate: selectedRoomType?.basePrice || roomForm.rate
                          });
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-bold outline-none cursor-pointer text-slate-900 dark:text-white"
                      >
                        {roomTypes.filter(rt => rt.isActive).map(rt => (
                          <option key={rt.id} value={rt.name}>{rt.name} - ${rt.basePrice}/night</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Room Type Preview Card */}
                  {roomForm.roomTypeId && (() => {
                    const selectedRoomType = roomTypes.find(rt => rt.id === roomForm.roomTypeId);
                    if (!selectedRoomType) return null;
                    return (
                      <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
                        <div className="flex gap-3">
                          {selectedRoomType.imageUrl1 && (
                            <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0">
                              <img src={selectedRoomType.imageUrl1} alt={selectedRoomType.name} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase">{selectedRoomType.name}</h4>
                            <p className="text-[10px] text-slate-500 line-clamp-2 mb-2">{selectedRoomType.description}</p>
                            <div className="flex items-center gap-3 mb-2">
                              <div className="flex items-center gap-1 text-[9px] text-slate-600">
                                <DollarSign size={10} className="text-emerald-500" />
                                <span className="font-bold">${selectedRoomType.basePrice}/night</span>
                              </div>
                              <div className="flex items-center gap-1 text-[9px] text-slate-600">
                                <Users size={10} className="text-indigo-500" />
                                <span className="font-bold">{selectedRoomType.maxOccupancy} guests</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {selectedRoomType.amenities.slice(0, 4).map((amenity, idx) => (
                                <span key={idx} className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[8px]">
                                  {amenity}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="space-y-1">
                    <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest ml-1 block mb-1">In-Room Amenities features</label>
                    <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950 rounded-2xl">
                      {availableFeatures.map((f) => {
                        const isChecked = roomForm.features.includes(f);
                        return (
                          <label key={f} className="flex items-center gap-1.5 p-1 cursor-pointer text-2xs font-semibold">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setRoomForm({ ...roomForm, features: roomForm.features.filter(feat => feat !== f) });
                                } else {
                                  setRoomForm({ ...roomForm, features: [...roomForm.features, f] });
                                }
                              }}
                              className="accent-indigo-600 rounded"
                            />
                            <span className="text-slate-800 dark:text-slate-350">{f}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition"
                  >
                    Register Mapping Unit
                  </button>
                </form>
              )}

      </ModalSystem>

      {/* EDIT REGISTRY MODAL */}
      <ModalSystem
        isOpen={showEditModal && !!editItem}
        onClose={() => setShowEditModal(false)}
        title="Modify Registry Reference"
        subtitle={`Editing ${category.slice(0, -1)} Record: ${editItem?.id}`}
        variant="form"
        size="xl"
        showFooter={false}
      >
              <form onSubmit={handleUpdateItem} className="space-y-6">
                {!editItem && (
                  <div className="text-center py-8 text-slate-400 text-xs">No item selected for editing</div>
                )}
                {editItem && category === 'rooms' && (
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Unit Number</label>
                      <input 
                        type="text" 
                        value={editItem.number || ''}
                        onChange={(e) => setEditItem({ ...editItem, number: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Category Type</label>
                      <select 
                         value={editItem.type || ''}
                         onChange={(e) => setEditItem({ ...editItem, type: e.target.value as any })}
                         className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-bold"
                      >
                         {(globalHotelSettings.roomTypes || []).map(t => (
                           <option key={t} value={t}>{t}</option>
                         ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Base rate ($)</label>
                      <input 
                        type="number" 
                        value={editItem.rate}
                        onChange={(e) => setEditItem({ ...editItem, rate: Number(e.target.value) })}
                        className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest">Maintenance Status</label>
                      <select 
                         value={editItem.status}
                         onChange={(e) => setEditItem({ ...editItem, status: e.target.value as any })}
                         className="w-full bg-slate-50 dark:bg-slate-950 border-none rounded-xl px-4 py-3 text-xs font-bold"
                      >
                         <option value="Vacant Clean">Vacant Clean</option>
                         <option value="Occupied">Occupied</option>
                         <option value="Out of Order">Out of Order</option>
                         <option value="Maintenance">Maintenance Required</option>
                      </select>
                    </div>
                  </div>
                )}

                <button 
                  type="submit"
                  className="w-full py-5 bg-indigo-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-500/20 hover:scale-[1.02] transition active:scale-[0.98]"
                >
                  Commit Modifications to Registry
                </button>
              </form>
      </ModalSystem>
    </div>
  );
}
