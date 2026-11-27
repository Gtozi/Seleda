/**
 * Front Office Transportation Module
 * Airport transfers, shuttle services, and vehicle management
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Car,
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
  User,
  Plane,
  MapPin,
  Calendar,
  Phone,
  Route,
  Wrench,
  Loader2
} from 'lucide-react';
import StatCard from '../StatCard';
import { useERP } from '../../../context/ERPContext';

type TripStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
type TripType = 'airport_pickup' | 'airport_dropoff' | 'local_transfer' | 'shuttle' | 'other';
type VehicleStatus = 'available' | 'in_use' | 'maintenance' | 'out_of_service';

interface Trip {
  id: string;
  guestName: string;
  roomNumber: string;
  reservationId?: string;
  type: TripType;
  status: TripStatus;
  pickupLocation: string;
  dropoffLocation: string;
  scheduledDate: string;
  scheduledTime: string;
  vehicleId?: string;
  driverId?: string;
  passengers: number;
  luggage: number;
  flightNumber?: string;
  notes: string;
  cost?: number;
  paymentStatus: 'paid' | 'pending' | 'complimentary';
  completedAt?: string;
}

interface Vehicle {
  id: string;
  name: string;
  type: 'sedan' | 'suv' | 'van' | 'bus' | 'shuttle';
  plateNumber: string;
  capacity: number;
  status: VehicleStatus;
  driverId?: string;
  fuelLevel: number;
  lastMaintenance: string;
  nextMaintenance?: string;
}

interface Driver {
  id: string;
  name: string;
  phone: string;
  licenseNumber: string;
  status: 'available' | 'on_trip' | 'off_duty';
  assignedVehicleId?: string;
  activeTrips: number;
}

const REQUEST_TO_TRIP_STATUS: Record<string, TripStatus> = {
  'Requested': 'scheduled',
  'Confirmed': 'confirmed',
  'Assigned': 'confirmed',
  'Driver En Route': 'in_progress',
  'Guest Picked Up': 'in_progress',
  'In Progress': 'in_progress',
  'Completed': 'completed',
  'Cancelled': 'cancelled',
  'No Show': 'cancelled',
};

const REQUEST_TO_TRIP_TYPE: Record<string, TripType> = {
  'Airport Pickup': 'airport_pickup',
  'Airport Drop-off': 'airport_dropoff',
  'City Transfer': 'local_transfer',
  'Hotel Shuttle': 'shuttle',
  'Staff Shuttle': 'shuttle',
  'Sightseeing Tour': 'local_transfer',
  'VIP Transport': 'other',
  'Courier Service': 'other',
};

const TRIP_TYPE_TO_REQUEST: Record<TripType, string> = {
  airport_pickup: 'Airport Pickup',
  airport_dropoff: 'Airport Drop-off',
  local_transfer: 'City Transfer',
  shuttle: 'Hotel Shuttle',
  other: 'City Transfer',
};

const VEHICLE_TO_STATUS: Record<string, VehicleStatus> = {
  'Active': 'available',
  'In Use': 'in_use',
  'Maintenance': 'maintenance',
  'Out of Service': 'out_of_service',
  'Retired': 'out_of_service',
  'Sold': 'out_of_service',
};

const VEHICLE_TO_TYPE: Record<string, Vehicle['type']> = {
  Sedan: 'sedan',
  SUV: 'suv',
  Van: 'van',
  Bus: 'bus',
  Shuttle: 'shuttle',
  Limousine: 'sedan',
  Minibus: 'bus',
};

function transportHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('hotel_erp_session') || localStorage.getItem('auth_token')
    : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const Transportation = () => {
  const { currentPropertyId } = useERP();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('view') as 'trips' | 'vehicles' | 'drivers' | 'schedule') || 'trips';
  const setActiveTab = (tab: 'trips' | 'vehicles' | 'drivers' | 'schedule') => {
    const next = new URLSearchParams(searchParams);
    next.set('view', tab);
    setSearchParams(next);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [showTripModal, setShowTripModal] = useState(false);

  const [tripForm, setTripForm] = useState({
    guestName: '',
    roomNumber: '',
    reservationId: '',
    type: 'airport_pickup' as TripType,
    pickupLocation: '',
    dropoffLocation: '',
    scheduledDate: '',
    scheduledTime: '',
    passengers: '1',
    luggage: '1',
    flightNumber: '',
    notes: '',
    cost: '',
    paymentStatus: 'pending' as 'paid' | 'pending' | 'complimentary'
  });

  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentPropertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = transportHeaders();
      const [reqRes, vehRes, drvRes] = await Promise.all([
        fetch(`/api/transport/requests/${currentPropertyId}`, { headers, credentials: 'include' }),
        fetch(`/api/transport/vehicles/${currentPropertyId}`, { headers, credentials: 'include' }),
        fetch(`/api/transport/drivers/${currentPropertyId}`, { headers, credentials: 'include' }),
      ]);
      const reqJson = await reqRes.json().catch(() => ({}));
      const vehJson = await vehRes.json().catch(() => ({}));
      const drvJson = await drvRes.json().catch(() => ({}));
      if (!reqRes.ok) throw new Error(reqJson.error || 'Failed to load trips');
      if (!vehRes.ok) throw new Error(vehJson.error || 'Failed to load vehicles');
      if (!drvRes.ok) throw new Error(drvJson.error || 'Failed to load drivers');

      const requests: any[] = reqJson.requests || [];
      const vehicleRows: any[] = vehJson.vehicles || [];
      const driverRows: any[] = drvJson.drivers || [];

      setVehicles(vehicleRows.map((v: any) => ({
        id: v.id,
        name: [v.make, v.model].filter(Boolean).join(' ') || v.vehicle_number,
        type: VEHICLE_TO_TYPE[v.category] || 'sedan',
        plateNumber: v.plate_number || v.vehicle_number || '-',
        capacity: v.capacity ?? 4,
        status: VEHICLE_TO_STATUS[v.status] || 'available',
        driverId: v.assigned_driver_id,
        fuelLevel: v.fuel_level ?? 0,
        lastMaintenance: v.last_maintenance_date || '',
        nextMaintenance: v.next_maintenance_date,
      })));

      const activeByDriver = new Map<string, number>();
      requests.forEach((r: any) => {
        const s = REQUEST_TO_TRIP_STATUS[r.status];
        if (r.driver_id && s && ['scheduled', 'confirmed', 'in_progress'].includes(s)) {
          activeByDriver.set(r.driver_id, (activeByDriver.get(r.driver_id) || 0) + 1);
        }
      });

      setDrivers(driverRows.map((d: any) => {
        const active = activeByDriver.get(d.id) || 0;
        return {
          id: d.id,
          name: d.employees?.name || d.name || 'Driver',
          phone: d.employees?.phone || d.phone || '-',
          licenseNumber: d.license_number || '-',
          status: active > 0 ? 'on_trip' : (d.status === 'Active' ? 'available' : 'off_duty'),
          assignedVehicleId: d.assigned_vehicle,
          activeTrips: active,
        } as Driver;
      }));

      setTrips(requests.map((r: any) => {
        const scheduled = r.scheduled_time ? new Date(r.scheduled_time) : null;
        return {
          id: r.id,
          guestName: r.guest_name || 'Guest',
          roomNumber: r.room || '-',
          reservationId: r.reservation_id,
          type: REQUEST_TO_TRIP_TYPE[r.type] || 'other',
          status: REQUEST_TO_TRIP_STATUS[r.status] || 'scheduled',
          pickupLocation: r.pickup_location || '',
          dropoffLocation: r.destination || '',
          scheduledDate: scheduled ? scheduled.toISOString().slice(0, 10) : '',
          scheduledTime: scheduled ? scheduled.toTimeString().slice(0, 5) : '',
          vehicleId: r.vehicle_id,
          driverId: r.driver_id,
          passengers: r.passenger_count || 1,
          luggage: 0,
          flightNumber: r.flight_number,
          notes: r.special_instructions || '',
          cost: Number(r.amount) || 0,
          paymentStatus: (r.payment_method === 'Complimentary' || !r.amount) ? 'complimentary' : 'pending',
          completedAt: r.completed_at,
        };
      }));
    } catch (e: any) {
      setError(e.message || 'Failed to load transportation data');
    } finally {
      setLoading(false);
    }
  }, [currentPropertyId]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateTripStatus = async (tripId: string, status: 'Completed' | 'Cancelled') => {
    try {
      const res = await fetch(`/api/transport/requests/${tripId}`, {
        method: 'PUT',
        headers: transportHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Update failed');
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Could not update trip');
    }
  };

  const filteredTrips = trips.filter(trip => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      trip.guestName.toLowerCase().includes(q) ||
      trip.roomNumber.toLowerCase().includes(q) ||
      trip.pickupLocation.toLowerCase().includes(q) ||
      trip.dropoffLocation.toLowerCase().includes(q) ||
      (trip.flightNumber && trip.flightNumber.toLowerCase().includes(q))
    );
  });

  const getStatusBadge = (status: TripStatus) => {
    const config: Record<TripStatus, { bg: string; text: string; label: string }> = {
      scheduled: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Scheduled' },
      confirmed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Confirmed' },
      in_progress: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'In Progress' },
      completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
      cancelled: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Cancelled' },
    };
    const c = config[status];
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const getVehicleStatusBadge = (status: VehicleStatus) => {
    const config: Record<VehicleStatus, { bg: string; text: string; label: string }> = {
      available: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Available' },
      in_use: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'In Use' },
      maintenance: { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Maintenance' },
      out_of_service: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Out of Service' },
    };
    const c = config[status];
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const handleTripSubmit = async () => {
    if (!currentPropertyId) return;
    if (!tripForm.guestName.trim() || !tripForm.pickupLocation.trim() || !tripForm.scheduledDate || !tripForm.scheduledTime) {
      setModalError('Guest name, pickup location, date and time are required');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await fetch('/api/transport/requests', {
        method: 'POST',
        headers: transportHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          propertyId: currentPropertyId,
          guestName: tripForm.guestName.trim(),
          room: tripForm.roomNumber.trim() || null,
          type: TRIP_TYPE_TO_REQUEST[tripForm.type],
          source: 'Front Office',
          pickupLocation: tripForm.pickupLocation.trim(),
          destination: tripForm.dropoffLocation.trim() || tripForm.pickupLocation.trim(),
          scheduledTime: new Date(`${tripForm.scheduledDate}T${tripForm.scheduledTime}:00`).toISOString(),
          passengerCount: Math.max(1, parseInt(tripForm.passengers) || 1),
          luggageCount: Math.max(0, parseInt(tripForm.luggage) || 0),
          status: 'Requested',
          specialInstructions: [
            tripForm.flightNumber ? `Flight ${tripForm.flightNumber}` : '',
            tripForm.notes,
          ].filter(Boolean).join(' · ') || null,
          amount: parseFloat(tripForm.cost) || 0,
          paymentMethod: tripForm.paymentStatus === 'complimentary' ? 'Complimentary' : 'Guest Folio',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Booking failed');
      setShowTripModal(false);
      setTripForm({
        guestName: '',
        roomNumber: '',
        reservationId: '',
        type: 'airport_pickup' as TripType,
        pickupLocation: '',
        dropoffLocation: '',
        scheduledDate: '',
        scheduledTime: '',
        passengers: '1',
        luggage: '1',
        flightNumber: '',
        notes: '',
        cost: '',
        paymentStatus: 'pending' as 'paid' | 'pending' | 'complimentary'
      });
      await loadData();
    } catch (e: any) {
      setModalError(e.message || 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const TabButton = ({ id, label, icon: Icon }: { id: typeof activeTab; label: string; icon: any }) => (
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
    <div className="space-y-6 animate-fade-in" id="transportation">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Transportation</h2>
          <p className="text-sm text-slate-500 mt-1">Airport transfers, shuttle services, and vehicle management</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTripModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors cursor-pointer"
          >
            <Plus size={16} />
            New Trip
          </button>
          <button
            onClick={loadData}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Trips" value={String(trips.filter(t => t.status === 'in_progress').length)} icon={Route} variant="primary" />
        <StatCard label="Scheduled Today" value={String(trips.filter(t => t.scheduledDate === new Date().toISOString().slice(0, 10) && ['scheduled', 'confirmed'].includes(t.status)).length)} icon={Calendar} variant="alert" />
        <StatCard label="Available Vehicles" value={String(vehicles.filter(v => v.status === 'available').length)} icon={Car} variant="rooms" />
        <StatCard label="Available Drivers" value={String(drivers.filter(d => d.status === 'available').length)} icon={User} variant="guests" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabButton id="trips" label="Trips" icon={Route} />
        <TabButton id="vehicles" label="Vehicles" icon={Car} />
        <TabButton id="drivers" label="Drivers" icon={User} />
        <TabButton id="schedule" label="Schedule" icon={Calendar} />
      </div>

      {/* Search & Filter */}
      {(activeTab === 'trips' || activeTab === 'schedule') && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search trips..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-slate-600 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
            <Filter size={16} />
            Filter
            <ChevronDown size={14} />
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading transportation data...
        </div>
      )}

      {/* Trips Tab */}
      {!loading && activeTab === 'trips' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Transport Trips</h3>
            <span className="text-xs text-slate-500">{filteredTrips.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length} active</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Guest</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Route</th>
                  <th className="px-4 py-3 text-left font-semibold">Scheduled</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Payment</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTrips.filter(t => t.status !== 'completed' && t.status !== 'cancelled').map((trip) => (
                  <tr key={trip.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{trip.guestName}</div>
                      <div className="text-xs text-slate-500">Room {trip.roomNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-slate-600">
                        {trip.type === 'airport_pickup' && <Plane size={16} />}
                        {trip.type === 'airport_dropoff' && <Plane size={16} />}
                        {trip.type === 'local_transfer' && <MapPin size={16} />}
                        {trip.type === 'shuttle' && <Car size={16} />}
                        <span className="capitalize">{trip.type.replace('_', ' ')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-600 max-w-xs truncate">{trip.pickupLocation}</div>
                      <div className="text-xs text-slate-500">→ {trip.dropoffLocation}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{trip.scheduledDate}</div>
                      <div className="text-xs text-slate-500">{trip.scheduledTime}</div>
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(trip.status)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        trip.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                        trip.paymentStatus === 'pending' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {trip.paymentStatus.charAt(0).toUpperCase() + trip.paymentStatus.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => updateTripStatus(trip.id, 'Completed')}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer"
                          title="Complete"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                        <button
                          onClick={() => updateTripStatus(trip.id, 'Cancelled')}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          title="Cancel"
                        >
                          <XCircle size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vehicles Tab */}
      {!loading && activeTab === 'vehicles' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Vehicle Fleet</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Vehicle</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Plate</th>
                  <th className="px-4 py-3 text-left font-semibold">Capacity</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Fuel</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{vehicle.name}</td>
                    <td className="px-4 py-3 text-slate-600 capitalize">{vehicle.type}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{vehicle.plateNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{vehicle.capacity} passengers</td>
                    <td className="px-4 py-3">{getVehicleStatusBadge(vehicle.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full ${vehicle.fuelLevel > 50 ? 'bg-emerald-500' : vehicle.fuelLevel > 25 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${vehicle.fuelLevel}%` }}></div>
                        </div>
                        <span className="text-xs text-slate-600">{vehicle.fuelLevel}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer" title="Edit">
                          <Edit size={16} />
                        </button>
                        <button className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer" title="Maintenance">
                          <Wrench size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drivers Tab */}
      {!loading && activeTab === 'drivers' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Drivers</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Driver</th>
                  <th className="px-4 py-3 text-left font-semibold">Phone</th>
                  <th className="px-4 py-3 text-left font-semibold">License</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Vehicle</th>
                  <th className="px-4 py-3 text-left font-semibold">Active Trips</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.map((driver) => (
                  <tr key={driver.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{driver.name}</td>
                    <td className="px-4 py-3 text-slate-600">{driver.phone}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{driver.licenseNumber}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        driver.status === 'available' ? 'bg-emerald-100 text-emerald-700' :
                        driver.status === 'on_trip' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {driver.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{driver.assignedVehicleId || '-'}</td>
                    <td className="px-4 py-3 text-slate-900">{driver.activeTrips}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer" title="Call">
                          <Phone size={16} />
                        </button>
                        <button className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer" title="Edit">
                          <Edit size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule Tab */}
      {!loading && activeTab === 'schedule' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">Today's Schedule</h3>
          <div className="space-y-3">
            {filteredTrips.filter(t => t.scheduledDate === new Date().toISOString().slice(0, 10)).map((trip) => (
              <div key={trip.id} className="p-4 border border-slate-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{trip.guestName}</span>
                      <span className="text-xs text-slate-500">Room {trip.roomNumber}</span>
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      {trip.pickupLocation} → {trip.dropoffLocation}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {trip.scheduledDate} at {trip.scheduledTime} · {trip.passengers} passenger(s)
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-600">{trip.scheduledTime}</div>
                    {trip.cost && <div className="text-sm font-medium text-slate-900">${trip.cost}</div>}
                    <div className="mt-1">{getStatusBadge(trip.status)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trip Modal */}
      {showTripModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Book Transportation</h3>
              <button onClick={() => setShowTripModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Guest Name</label>
                  <input
                    type="text"
                    value={tripForm.guestName}
                    onChange={(e) => setTripForm({ ...tripForm, guestName: e.target.value })}
                    placeholder="Enter guest name"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Room Number</label>
                  <input
                    type="text"
                    value={tripForm.roomNumber}
                    onChange={(e) => setTripForm({ ...tripForm, roomNumber: e.target.value })}
                    placeholder="Room number"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Trip Type</label>
                  <select
                    value={tripForm.type}
                    onChange={(e) => setTripForm({ ...tripForm, type: e.target.value as TripType })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="airport_pickup">Airport Pickup</option>
                    <option value="airport_dropoff">Airport Drop-off</option>
                    <option value="local_transfer">Local Transfer</option>
                    <option value="shuttle">Shuttle</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Passengers</label>
                  <input
                    type="number"
                    value={tripForm.passengers}
                    onChange={(e) => setTripForm({ ...tripForm, passengers: e.target.value })}
                    placeholder="1"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Pickup Location</label>
                  <input
                    type="text"
                    value={tripForm.pickupLocation}
                    onChange={(e) => setTripForm({ ...tripForm, pickupLocation: e.target.value })}
                    placeholder="Pickup address"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Drop-off Location</label>
                  <input
                    type="text"
                    value={tripForm.dropoffLocation}
                    onChange={(e) => setTripForm({ ...tripForm, dropoffLocation: e.target.value })}
                    placeholder="Drop-off address"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Date</label>
                  <input
                    type="date"
                    value={tripForm.scheduledDate}
                    onChange={(e) => setTripForm({ ...tripForm, scheduledDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Time</label>
                  <input
                    type="time"
                    value={tripForm.scheduledTime}
                    onChange={(e) => setTripForm({ ...tripForm, scheduledTime: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Flight Number (if airport)</label>
                  <input
                    type="text"
                    value={tripForm.flightNumber}
                    onChange={(e) => setTripForm({ ...tripForm, flightNumber: e.target.value })}
                    placeholder="e.g., ET456"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Cost ($)</label>
                  <input
                    type="number"
                    value={tripForm.cost}
                    onChange={(e) => setTripForm({ ...tripForm, cost: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                <textarea
                  value={tripForm.notes}
                  onChange={(e) => setTripForm({ ...tripForm, notes: e.target.value })}
                  rows={2}
                  placeholder="Additional notes..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200">
              {modalError && <span className="mr-auto text-sm text-rose-600">{modalError}</span>}
              <button onClick={() => setShowTripModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium cursor-pointer">Cancel</button>
              <button onClick={handleTripSubmit} disabled={submitting} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Book Trip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transportation;
