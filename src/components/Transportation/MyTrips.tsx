/**
 * My Trips — driver self-service view.
 * Shows the trips assigned to the signed-in driver and lets them advance the
 * trip through its lifecycle via /api/transport/requests/driver/*.
 * Requires a transport_drivers row linked to the caller's employee record.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Car, RefreshCw, MapPin, Clock, Users, AlertTriangle, CheckCircle2, Navigation,
} from 'lucide-react';

interface Trip {
  id: string;
  request_number: string;
  guest_name: string;
  room?: string | null;
  type: string;
  source?: string;
  pickup_location: string;
  destination: string;
  scheduled_time: string;
  passenger_count: number;
  status: string;
  special_instructions?: string | null;
  assigned_vehicle?: string | null;
}

const NEXT_ACTIONS: Record<string, { status: string; label: string; tone: string }[]> = {
  'Assigned': [
    { status: 'Driver En Route', label: 'Start — En Route', tone: 'primary' },
    { status: 'No Show', label: 'No Show', tone: 'muted' },
    { status: 'Cancelled', label: 'Cancel', tone: 'danger' },
  ],
  'Confirmed': [
    { status: 'Driver En Route', label: 'Start — En Route', tone: 'primary' },
    { status: 'Cancelled', label: 'Cancel', tone: 'danger' },
  ],
  'Driver En Route': [
    { status: 'Guest Picked Up', label: 'Guest Picked Up', tone: 'primary' },
    { status: 'No Show', label: 'No Show', tone: 'muted' },
    { status: 'Cancelled', label: 'Cancel', tone: 'danger' },
  ],
  'Guest Picked Up': [
    { status: 'In Progress', label: 'Trip In Progress', tone: 'primary' },
    { status: 'Completed', label: 'Complete Trip', tone: 'success' },
  ],
  'In Progress': [
    { status: 'Completed', label: 'Complete Trip', tone: 'success' },
  ],
};

const TONE_CLASSES: Record<string, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white',
  muted: 'bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200',
};

const STATUS_COLORS: Record<string, string> = {
  'Confirmed': 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  'Assigned': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400',
  'Driver En Route': 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  'Guest Picked Up': 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400',
  'In Progress': 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400',
};

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const MyTrips: React.FC = () => {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [noDriverProfile, setNoDriverProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/transport/requests/driver/mine', { headers: authHeaders() });
      if (res.status === 403) {
        setNoDriverProfile(true);
        setTrips([]);
        return;
      }
      if (!res.ok) throw new Error(`Failed to load trips (${res.status})`);
      const data = await res.json();
      setTrips(Array.isArray(data) ? data : data.requests || []);
      setNoDriverProfile(false);
    } catch (e: any) {
      setError(e?.message || 'Failed to load trips');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (trip: Trip, status: string) => {
    setUpdatingId(trip.id);
    setError(null);
    try {
      const res = await fetch(`/api/transport/requests/driver/${trip.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  if (noDriverProfile) {
    return (
      <div className="p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
          <Car size={32} className="mx-auto text-slate-400 mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">No driver profile</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            This account isn't linked to an active driver record. Ask a transportation manager to link
            your employee record in Driver Management.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Trips</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Trips assigned to you — update status as the trip progresses
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading your trips...</div>
      ) : trips.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
          <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-500" />
          No active trips assigned to you right now.
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => (
            <div key={trip.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{trip.request_number}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[trip.status] || 'bg-slate-100 text-slate-600'}`}>
                      {trip.status}
                    </span>
                  </div>
                  <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {trip.guest_name}{trip.room ? ` · Room ${trip.room}` : ''}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
                    <MapPin size={13} className="text-slate-400 shrink-0" />
                    <span className="truncate">{trip.pickup_location}</span>
                    <span className="text-slate-400">→</span>
                    <span className="truncate">{trip.destination}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {new Date(trip.scheduled_time).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={12} /> {trip.passenger_count} pax
                    </span>
                    {trip.assigned_vehicle && (
                      <span className="flex items-center gap-1">
                        <Navigation size={12} /> {trip.assigned_vehicle}
                      </span>
                    )}
                    <span>{trip.type}</span>
                  </div>
                  {trip.special_instructions && (
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 italic">{trip.special_instructions}</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(NEXT_ACTIONS[trip.status] || []).map((a) => (
                    <button
                      key={a.status}
                      onClick={() => updateStatus(trip, a.status)}
                      disabled={updatingId === trip.id}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50 ${TONE_CLASSES[a.tone]}`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyTrips;
