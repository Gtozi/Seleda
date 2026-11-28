/**
 * Front Office Configuration Module
 * Hotel and front office setup, settings, and configuration
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Settings,
  Plus,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Edit,
  Save,
  X,
  ChevronDown,
  Building2,
  Clock,
  Users,
  FileText,
  Shield,
  CreditCard,
  Bell,
  MapPin,
  Phone,
  Mail,
  Globe,
  Printer,
  Moon,
  Sliders,
  Trash2,
  BedDouble
} from 'lucide-react';
import StatCard from '../StatCard';
import { useERP } from '../../../context/ERPContext';
import { ModalSystem } from '../../Shared/ModalSystem';
import type { Room, RoomStatus } from '../../../types/erp';
import RoomTypeManager from '../../Admin/MasterData/RoomTypeManager';
import AttributeManager from '../../Admin/MasterData/AttributeManager';

type ConfigSection = 'general' | 'property' | 'rooms' | 'attributes' | 'night_audit' | 'policies' | 'payment' | 'notifications' | 'integrations';

interface HotelSettings {
  name: string;
  code: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  timeZone: string;
  currency: string;
  language: string;
}

interface PolicyConfig {
  id: string;
  name: string;
  type: 'check_in' | 'check_out' | 'cancellation' | 'payment' | 'housekeeping' | 'other';
  description: string;
  active: boolean;
}

const Configuration = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('view') as ConfigSection) || 'general';
  const setActiveTab = (tab: ConfigSection) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', tab);
    setSearchParams(next);
  };
  const {
    rooms,
    roomTypes,
    addRoom,
    updateRoom,
    deleteRoom,
    formatAmount,
    globalHotelSettings,
    submitGlobalSettingsChange,
  } = useERP();
  const [naForm, setNaForm] = useState({
    autoNightAuditTime: globalHotelSettings.autoNightAuditTime || '02:00',
    enableAutoNightAudit: !!globalHotelSettings.autoNightAuditTime,
    postRoomCharges: globalHotelSettings.nightAuditPostRoomCharges ?? true,
    generateDailySummary: globalHotelSettings.nightAuditGenerateSummary ?? true,
    autoCheckinReminders: globalHotelSettings.nightAuditCheckinReminders ?? true,
  });
  const [naSaved, setNaSaved] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const availableRoomTypes = (roomTypes.length > 0 ? roomTypes : globalHotelSettings.roomTypesDetailed || []).filter(rt => rt.isActive !== false);
  const availableFeatures = globalHotelSettings.roomFeatures || ['Wifi', 'TV', 'Desk', 'Mini-bar', 'AC', 'Ocean View', 'Garden View', 'Safe', 'Jaccuzi', 'Coffee machine', 'Private Terrace'];

  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomFormError, setRoomFormError] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState<{
    number: string;
    type: string;
    roomTypeId: string;
    floor: number;
    rate: number;
    status: RoomStatus;
    features: string[];
  }>({
    number: '',
    type: '',
    roomTypeId: '',
    floor: 1,
    rate: 100,
    status: 'Vacant Clean',
    features: [],
  });

  const openAddRoomModal = () => {
    const defaultType = availableRoomTypes[0];
    setEditingRoom(null);
    setRoomFormError(null);
    setRoomForm({
      number: '',
      type: defaultType?.name || '',
      roomTypeId: defaultType?.id || '',
      floor: 1,
      rate: defaultType?.basePrice ?? 100,
      status: 'Vacant Clean',
      features: [],
    });
    setShowRoomModal(true);
  };

  const openEditRoomModal = (room: Room) => {
    setEditingRoom(room);
    setRoomFormError(null);
    setRoomForm({
      number: room.number,
      type: room.type,
      roomTypeId: room.roomTypeId || '',
      floor: room.floor,
      rate: room.rate,
      status: room.status,
      features: room.features || [],
    });
    setShowRoomModal(true);
  };

  const handleRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNumber = roomForm.number.trim();
    if (!trimmedNumber) {
      setRoomFormError('Room number is required.');
      return;
    }
    const duplicate = rooms.find(
      r => r.number.toLowerCase() === trimmedNumber.toLowerCase() && r.id !== editingRoom?.id
    );
    if (duplicate) {
      setRoomFormError(`Room ${trimmedNumber} is already registered.`);
      return;
    }
    if (!roomForm.type) {
      setRoomFormError('Please select a room type.');
      return;
    }

    if (editingRoom) {
      updateRoom(editingRoom.id, {
        number: trimmedNumber,
        type: roomForm.type,
        roomTypeId: roomForm.roomTypeId,
        floor: Number(roomForm.floor) || 1,
        rate: Number(roomForm.rate) || 0,
        status: roomForm.status,
        features: roomForm.features,
      });
    } else {
      addRoom({
        number: trimmedNumber,
        type: roomForm.type,
        roomTypeId: roomForm.roomTypeId,
        floor: Number(roomForm.floor) || 1,
        rate: Number(roomForm.rate) || 0,
        status: roomForm.status,
        features: roomForm.features,
      });
    }
    setShowRoomModal(false);
    setEditingRoom(null);
  };

  const filteredRooms = rooms.filter(r => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.number.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q) ||
      String(r.floor).includes(q)
    );
  });

  const [hotelSettings, setHotelSettings] = useState<HotelSettings>({
    name: 'SELEDA Hotel',
    code: 'SEL',
    address: '123 Main Street',
    city: 'Addis Ababa',
    country: 'Ethiopia',
    phone: '+251 11 123 4567',
    email: 'info@seledahotel.com',
    website: 'www.seledahotel.com',
    timeZone: 'Africa/Addis_Ababa',
    currency: 'ETB',
    language: 'en',
  });

  const [policies] = useState<PolicyConfig[]>([
    {
      id: 'POL-001',
      name: 'Check-in Policy',
      type: 'check_in',
      description: 'Check-in from 3:00 PM. Valid ID required. Security deposit may be required.',
      active: true,
    },
    {
      id: 'POL-002',
      name: 'Check-out Policy',
      type: 'check_out',
      description: 'Check-out by 11:00 AM. Late check-out available upon request (subject to availability).',
      active: true,
    },
    {
      id: 'POL-003',
      name: 'Cancellation Policy',
      type: 'cancellation',
      description: 'Free cancellation up to 24 hours before check-in. Late cancellations charged for first night.',
      active: true,
    },
    {
      id: 'POL-004',
      name: 'Payment Policy',
      type: 'payment',
      description: 'Full payment required at check-in. Credit card guarantee required for reservations.',
      active: true,
    },
    {
      id: 'POL-005',
      name: 'Housekeeping Schedule',
      type: 'housekeeping',
      description: 'Daily housekeeping between 9:00 AM - 3:00 PM. Do not disturb available upon request.',
      active: true,
    },
  ]);

  const handleSave = () => {
    setHasChanges(false);
    setShowEditModal(false);
  };

  const handleSettingChange = (field: keyof HotelSettings, value: string) => {
    setHotelSettings({ ...hotelSettings, [field]: value });
    setHasChanges(true);
  };

  const TabButton = ({ id, label, icon: Icon }: { id: ConfigSection; label: string; icon: any }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
        activeTab === id
          ? 'bg-indigo-600 text-white shadow-md'
          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );

  return (
    <div className="space-y-6 animate-fade-in" id="configuration">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Configuration</h2>
          <p className="text-sm text-slate-500 mt-1">Hotel and front office setup, settings, and configuration</p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              <Save size={16} />
              Save Changes
            </button>
          )}
          <button className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Registered Rooms" value={String(rooms.length)} icon={BedDouble} variant="rooms" />
        <StatCard label="Active Policies" value="5" icon={FileText} variant="primary" />
        <StatCard label="Payment Methods" value="4" icon={CreditCard} variant="revenue" />
        <StatCard label="Integrations" value="6" icon={Globe} variant="primary" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabButton id="general" label="General" icon={Settings} />
        <TabButton id="property" label="Property" icon={Building2} />
        <TabButton id="rooms" label="Rooms" icon={Building2} />
        <TabButton id="attributes" label="Room Types & Attributes" icon={Sliders} />
        <TabButton id="night_audit" label="Night Audit" icon={Moon} />
        <TabButton id="policies" label="Policies" icon={FileText} />
        <TabButton id="payment" label="Payment" icon={CreditCard} />
        <TabButton id="notifications" label="Notifications" icon={Bell} />
        <TabButton id="integrations" label="Integrations" icon={Globe} />
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">General Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Hotel Name</label>
              <input
                type="text"
                value={hotelSettings.name}
                onChange={(e) => handleSettingChange('name', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Hotel Code</label>
              <input
                type="text"
                value={hotelSettings.code}
                onChange={(e) => handleSettingChange('code', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Time Zone</label>
              <select
                value={hotelSettings.timeZone}
                onChange={(e) => handleSettingChange('timeZone', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="Africa/Addis_Ababa">Africa/Addis_Ababa</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="Europe/London">Europe/London</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Currency</label>
              <select
                value={hotelSettings.currency}
                onChange={(e) => handleSettingChange('currency', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="ETB">ETB - Ethiopian Birr</option>
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Language</label>
              <select
                value={hotelSettings.language}
                onChange={(e) => handleSettingChange('language', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="en">English</option>
                <option value="am">Amharic</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Property Tab */}
      {activeTab === 'property' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">Property Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">Address</label>
              <input
                type="text"
                value={hotelSettings.address}
                onChange={(e) => handleSettingChange('address', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">City</label>
              <input
                type="text"
                value={hotelSettings.city}
                onChange={(e) => handleSettingChange('city', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Country</label>
              <input
                type="text"
                value={hotelSettings.country}
                onChange={(e) => handleSettingChange('country', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  value={hotelSettings.phone}
                  onChange={(e) => handleSettingChange('phone', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="email"
                  value={hotelSettings.email}
                  onChange={(e) => handleSettingChange('email', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">Website</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="url"
                  value={hotelSettings.website}
                  onChange={(e) => handleSettingChange('website', e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rooms Tab */}
      {activeTab === 'rooms' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Room Registry ({filteredRooms.length})</h3>
              <p className="text-xs text-slate-500">Register and manage physical rooms, room numbers, floors, and room type assignments</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rooms..."
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <button
                onClick={openAddRoomModal}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                <Plus size={15} /> Register Room
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Room Number</th>
                  <th className="px-4 py-3 text-left font-semibold">Room Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Floor</th>
                  <th className="px-4 py-3 text-left font-semibold">Rate / Night</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Features</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRooms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">
                      No rooms registered yet. Click &ldquo;Register Room&rdquo; to add a room.
                    </td>
                  </tr>
                ) : (
                  filteredRooms.map((room) => (
                    <tr key={room.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white font-mono">
                        {room.number}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{room.type}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">Floor {room.floor}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">{formatAmount(room.rate)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          room.status.includes('Clean')
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : room.status.includes('Dirty')
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                        }`}>
                          {room.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(room.features || []).slice(0, 3).map((f) => (
                            <span key={f} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded text-xs">
                              {f}
                            </span>
                          ))}
                          {(room.features || []).length > 3 && (
                            <span className="px-1.5 py-0.5 text-slate-400 text-xs">+{room.features.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditRoomModal(room)}
                            className="p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                            title="Edit Room"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete Room ${room.number}? This cannot be undone.`)) {
                                deleteRoom(room.id);
                              }
                            }}
                            className="p-1.5 text-slate-600 dark:text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 rounded-lg cursor-pointer"
                            title="Delete Room"
                          >
                            <Trash2 size={16} />
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
      )}

      {/* Register / Edit Room Modal */}
      <ModalSystem
        isOpen={showRoomModal}
        onClose={() => { setShowRoomModal(false); setEditingRoom(null); }}
        title={editingRoom ? `Edit Room ${editingRoom.number}` : 'Register New Room'}
        variant="form"
        size="lg"
        showFooter={false}
      >
        <form onSubmit={handleRoomSubmit} className="space-y-4">
          {roomFormError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-medium">
              {roomFormError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Room Number *</label>
              <input
                type="text"
                required
                value={roomForm.number}
                onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })}
                placeholder="e.g. 101"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Room Type *</label>
              <select
                required
                value={roomForm.type}
                onChange={(e) => {
                  const selectedName = e.target.value;
                  const matched = availableRoomTypes.find(rt => rt.name === selectedName);
                  setRoomForm({
                    ...roomForm,
                    type: selectedName,
                    roomTypeId: matched?.id || '',
                    rate: matched?.basePrice ?? roomForm.rate,
                  });
                }}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="" disabled>Select room type</option>
                {availableRoomTypes.map(rt => (
                  <option key={rt.id} value={rt.name}>
                    {rt.name} ({formatAmount(rt.basePrice)}/night)
                  </option>
                ))}
                {roomForm.type && !availableRoomTypes.some(rt => rt.name === roomForm.type) && (
                  <option value={roomForm.type}>{roomForm.type}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Floor *</label>
              <input
                type="number"
                required
                min={0}
                value={roomForm.floor}
                onChange={(e) => setRoomForm({ ...roomForm, floor: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Base Rate / Night *</label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={roomForm.rate}
                onChange={(e) => setRoomForm({ ...roomForm, rate: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Status</label>
              <select
                value={roomForm.status}
                onChange={(e) => setRoomForm({ ...roomForm, status: e.target.value as RoomStatus })}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="Vacant Clean">Vacant Clean</option>
                <option value="Vacant Dirty">Vacant Dirty</option>
                <option value="Occupied Clean">Occupied Clean</option>
                <option value="Occupied Dirty">Occupied Dirty</option>
                <option value="Out of Order">Out of Order</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">In-Room Features</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
              {availableFeatures.map((feat) => {
                const checked = roomForm.features.includes(feat);
                return (
                  <label key={feat} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setRoomForm({
                          ...roomForm,
                          features: checked
                            ? roomForm.features.filter(f => f !== feat)
                            : [...roomForm.features, feat],
                        });
                      }}
                      className="accent-indigo-600 rounded"
                    />
                    <span>{feat}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowRoomModal(false); setEditingRoom(null); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              {editingRoom ? 'Save Changes' : 'Register Room'}
            </button>
          </div>
        </form>
      </ModalSystem>

      {/* Policies Tab */}
      {activeTab === 'policies' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Hotel Policies</h3>
            <button className="text-sm text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer">
              + Add Policy
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {policies.map((policy) => (
              <div key={policy.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{policy.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${policy.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {policy.active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-semibold rounded capitalize">{policy.type.replace('_', ' ')}</span>
                    </div>
                    <p className="text-sm text-slate-600 mt-2">{policy.description}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <button className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer" title="Edit">
                      <Edit size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Tab */}
      {activeTab === 'payment' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">Payment Configuration</h3>
          <div className="space-y-4">
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CreditCard size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Credit Card</div>
                    <div className="text-sm text-slate-500">Visa, Mastercard, Amex</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Enabled</span>
              </div>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Building2 size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Bank Transfer</div>
                    <div className="text-sm text-slate-500">Direct bank transfers</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Enabled</span>
              </div>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Phone size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Mobile Money</div>
                    <div className="text-sm text-slate-500">Telebirr, M-Pesa</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Enabled</span>
              </div>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Cash</div>
                    <div className="text-sm text-slate-500">Local currency only</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Enabled</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">Notification Settings</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
              <div>
                <div className="font-medium text-slate-900">Check-in Notifications</div>
                <div className="text-sm text-slate-500">Alert when guests check in</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
              <div>
                <div className="font-medium text-slate-900">Check-out Notifications</div>
                <div className="text-sm text-slate-500">Alert when guests check out</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
              <div>
                <div className="font-medium text-slate-900">Housekeeping Alerts</div>
                <div className="text-sm text-slate-500">Notify when rooms need cleaning</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
              <div>
                <div className="font-medium text-slate-900">OTA Booking Alerts</div>
                <div className="text-sm text-slate-500">Notify of new OTA bookings</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Room Types & Attributes Tab */}
      {activeTab === 'attributes' && (
        <div className="space-y-6">
          <RoomTypeManager
            roomTypes={globalHotelSettings.roomTypesDetailed || []}
            onUpdate={(items) => submitGlobalSettingsChange('Room Types', 'Update room types configuration', 'global-setting', { roomTypesDetailed: items })}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AttributeManager
              title="Room Features"
              items={globalHotelSettings.roomFeatures || []}
              onUpdate={(items) => submitGlobalSettingsChange('Room Features', `Update room features: ${items.join(', ') || 'none'}`, 'global-setting', { roomFeatures: items })}
            />
            <AttributeManager
              title="Guest Statuses"
              items={globalHotelSettings.guestStatuses || []}
              onUpdate={(items) => submitGlobalSettingsChange('Guest Statuses', `Update guest statuses: ${items.join(', ') || 'none'}`, 'global-setting', { guestStatuses: items })}
            />
          </div>
        </div>
      )}

      {/* Night Audit Automation Tab */}
      {activeTab === 'night_audit' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Night Audit Automation</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Configure end-of-day posting, summary generation, and pre-arrival reminders</p>
            </div>
            <button
              onClick={() => {
                submitGlobalSettingsChange(
                  'Night Audit Schedule',
                  `Set automatic night audit time to ${naForm.autoNightAuditTime} (${naForm.enableAutoNightAudit ? 'enabled' : 'disabled'})`,
                  'global-setting',
                  {
                    autoNightAuditTime: naForm.enableAutoNightAudit ? naForm.autoNightAuditTime : '',
                    nightAuditPostRoomCharges: naForm.postRoomCharges,
                    nightAuditGenerateSummary: naForm.generateDailySummary,
                    nightAuditCheckinReminders: naForm.autoCheckinReminders,
                  }
                );
                setNaSaved(true);
                setTimeout(() => setNaSaved(false), 2500);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition cursor-pointer"
            >
              {naSaved ? <CheckCircle2 size={16} /> : <Save size={16} />}
              {naSaved ? 'Saved' : 'Save Night Audit'}
            </button>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">Enable automatic Night Audit</div>
                <div className="text-sm text-slate-500">Run end-of-day posting and summary generation automatically</div>
              </div>
              <input type="checkbox" checked={naForm.enableAutoNightAudit} onChange={e => setNaForm(f => ({ ...f, enableAutoNightAudit: e.target.checked }))} />
            </label>
            <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Scheduled Time</label>
              <input type="time" value={naForm.autoNightAuditTime} onChange={e => setNaForm(f => ({ ...f, autoNightAuditTime: e.target.value }))} className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            </div>
            <label className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">Auto-post room charges</div>
                <div className="text-sm text-slate-500">Automatically post nightly room charges to active folios</div>
              </div>
              <input type="checkbox" checked={naForm.postRoomCharges} onChange={e => setNaForm(f => ({ ...f, postRoomCharges: e.target.checked }))} />
            </label>
            <label className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">Generate daily summary report</div>
                <div className="text-sm text-slate-500">Create and email the daily revenue and occupancy summary</div>
              </div>
              <input type="checkbox" checked={naForm.generateDailySummary} onChange={e => setNaForm(f => ({ ...f, generateDailySummary: e.target.checked }))} />
            </label>
            <label className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">Auto check-in reminders</div>
                <div className="text-sm text-slate-500">Send automated reminders to guests ahead of check-in</div>
              </div>
              <input type="checkbox" checked={naForm.autoCheckinReminders} onChange={e => setNaForm(f => ({ ...f, autoCheckinReminders: e.target.checked }))} />
            </label>
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">System Integrations</h3>
          <div className="space-y-4">
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Booking.com</div>
                    <div className="text-sm text-slate-500">Channel manager integration</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Connected</span>
              </div>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Expedia</div>
                    <div className="text-sm text-slate-500">Channel manager integration</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Connected</span>
              </div>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Printer size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">PMS Integration</div>
                    <div className="text-sm text-slate-500">Property management system</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Connected</span>
              </div>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield size={20} className="text-slate-400" />
                  <div>
                    <div className="font-medium text-slate-900">Payment Gateway</div>
                    <div className="text-sm text-slate-500">Secure payment processing</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded">Connected</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Configuration;
