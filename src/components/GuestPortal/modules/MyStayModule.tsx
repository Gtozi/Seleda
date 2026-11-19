/**
 * My Stay Module
 * Room details, folio charges, hotel directory, and today's itinerary.
 * Live data: GET /api/guest-portal/my-stay/:reservationId
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Home,
  CreditCard,
  Calendar,
  Phone,
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  BedDouble,
  UtensilsCrossed,
  Sparkles
} from 'lucide-react';

interface MyStayModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface StayReservation {
  id: string;
  guestId?: string;
  guestName?: string;
  status?: string;
  checkInDate?: string;
  checkOutDate?: string;
  guests?: number;
  roomNumber?: string | null;
  roomType?: string;
  rate?: number;
  paymentStatus?: string;
}

interface StayRoom {
  number: string;
  floor?: number | null;
  features?: string[];
  typeName?: string;
  bedConfiguration?: string;
  roomSizeSqft?: number;
  amenities?: string[];
}

interface StayProperty {
  name?: string;
  address?: string | Record<string, unknown> | null;
  email?: string;
  phone?: string;
  timezone?: string;
  starRating?: number;
  checkInTime?: string;
  checkOutTime?: string;
}

interface StayCharge {
  id: string;
  description?: string;
  amount: number;
  quantity: number;
  date?: string;
  category?: string;
}

interface StayFolio {
  folioNumber?: string;
  status?: string;
  balance: number;
  totalCharges: number;
  totalPayments: number;
  currency: string;
}

interface ItineraryItem {
  id: string;
  time: string;
  activity: string;
  location: string;
  description?: string;
}

interface ReservationListItem {
  id: string;
  status?: string;
  checkOutDate?: string;
}

const IN_HOUSE_STATUSES = new Set(['CheckedIn', 'Checked In', 'InHouse', 'In House']);
const UPCOMING_STATUSES = new Set(['Reserved', 'Pending', 'Confirmed']);

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleDateString();
}

function formatAddress(address: StayProperty['address']): string {
  if (!address) return '—';
  if (typeof address === 'string') return address;
  const a = address as Record<string, unknown>;
  return [a.street, a.city, a.state, a.country]
    .filter(v => typeof v === 'string' && v)
    .join(', ') || '—';
}

const EMERGENCY_DIRECTORY = [
  { name: 'Housekeeping', phone: '1', description: 'Room service and cleaning' },
  { name: 'Security', phone: '2', description: 'Emergency security' },
  { name: 'Medical Emergency', phone: '911', description: 'External emergency services' }
];

const MyStayModule: React.FC<MyStayModuleProps> = ({
  reservationId: reservationIdProp,
  guestId
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noContext, setNoContext] = useState(false);
  const [noEligible, setNoEligible] = useState(false);
  const [reservation, setReservation] = useState<StayReservation | null>(null);
  const [room, setRoom] = useState<StayRoom | null>(null);
  const [property, setProperty] = useState<StayProperty | null>(null);
  const [folio, setFolio] = useState<StayFolio | null>(null);
  const [charges, setCharges] = useState<StayCharge[]>([]);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadStay = useCallback(async (resId: string) => {
    const res = await fetch(`/api/guest-portal/my-stay/${encodeURIComponent(resId)}`, {
      headers: authHeaders(),
      credentials: 'include'
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to load stay (${res.status})`);
    }
    const body = await res.json();
    setReservation(body.reservation || null);
    setRoom(body.room || null);
    setProperty(body.property || null);
    setFolio(body.folio || null);
    setCharges(body.charges || []);
    setItinerary(body.itinerary || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let resId = reservationIdProp || '';
        if (!resId && guestId) {
          const res = await fetch(
            `/api/guest-portal/reservations/${encodeURIComponent(guestId)}`,
            { headers: authHeaders(), credentials: 'include' }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed to load reservations (${res.status})`);
          }
          const body = await res.json();
          const list: ReservationListItem[] = body.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          // In-house stay first, then soonest upcoming
          const inHouse = list.find(r => IN_HOUSE_STATUSES.has(String(r.status)));
          const upcoming = list
            .filter(r => UPCOMING_STATUSES.has(String(r.status)))
            .filter(r => String(r.checkOutDate || '') >= today)
            .sort((a, b) => String(a.checkOutDate).localeCompare(String(b.checkOutDate)));
          resId = (inHouse || upcoming[0])?.id || '';
        }
        if (!resId) {
          if (!cancelled) {
            if (guestId) setNoEligible(true); else setNoContext(true);
          }
          return;
        }
        if (!cancelled) await loadStay(resId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load stay');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reservationIdProp, guestId, loadStay]);

  const currency = folio?.currency || 'USD';
  const totalCharges = folio ? folio.balance : charges.reduce((sum, c) => sum + c.amount, 0);

  const itineraryIcon = (item: ItineraryItem) => {
    if (item.id.startsWith('spa-')) return <Sparkles size={16} className="text-purple-500" />;
    if (item.id.startsWith('dining-')) return <UtensilsCrossed size={16} className="text-amber-500" />;
    return <Calendar size={16} className="text-indigo-500" />;
  };

  // ── Render states ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading your stay…</p>
        </div>
      </div>
    );
  }

  if (noContext || noEligible) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Stay</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your room details and hotel information
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Home size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {noContext ? 'Sign in to view your stay' : 'No active or upcoming stay'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {noContext
              ? 'Link a guest profile to view your room and stay details.'
              : 'Room details and folio appear once you have a current or upcoming reservation.'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Stay</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your room details and hotel information
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Stay details unavailable</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const amenities = room?.amenities?.length ? room.amenities : (room?.features || []);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Stay</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {reservation
              ? `${reservation.guestName || 'Guest'} · ${formatDate(reservation.checkInDate)} → ${formatDate(reservation.checkOutDate)} · ${reservation.status || ''}`
              : 'Your room details and hotel information'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">Local Time</div>
        </div>
      </div>

      {/* Room Details */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Home size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Room Details</h3>
        </div>

        {!room && !reservation?.roomNumber ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No room assigned yet — your room details appear once the front desk assigns one.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Room Number</div>
                <div className="text-xl font-bold text-slate-900 dark:text-white">
                  {room?.number || reservation?.roomNumber || '—'}
                </div>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Room Type</div>
                <div className="text-lg font-medium text-slate-900 dark:text-white">
                  {room?.typeName || reservation?.roomType || '—'}
                </div>
              </div>
              {room?.floor != null && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                  <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Floor</div>
                  <div className="text-xl font-bold text-slate-900 dark:text-white">{room.floor}</div>
                </div>
              )}
              {room?.bedConfiguration && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                  <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Bed</div>
                  <div className="text-lg font-medium text-slate-900 dark:text-white">{room.bedConfiguration}</div>
                </div>
              )}
              {room?.roomSizeSqft != null && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                  <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Size</div>
                  <div className="text-lg font-medium text-slate-900 dark:text-white">{room.roomSizeSqft} sqft</div>
                </div>
              )}
            </div>

            {amenities.length > 0 && (
              <div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Room Amenities</div>
                <div className="flex flex-wrap gap-2">
                  {amenities.map((amenity) => (
                    <span
                      key={amenity}
                      className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded-full text-sm"
                    >
                      {amenity}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Current Charges */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
              <CreditCard size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Current Charges</h3>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {folio ? `Balance · ${folio.folioNumber || ''}` : 'Total'}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white">
              {currency} {totalCharges.toFixed(2)}
            </div>
          </div>
        </div>

        {charges.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <CreditCard size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No charges posted yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {charges.map((charge) => (
              <div key={charge.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">
                    {charge.description || 'Charge'}
                    {charge.quantity > 1 ? ` ×${charge.quantity}` : ''}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {charge.category || 'Other'} • {formatDate(charge.date)}
                  </div>
                </div>
                <div className="font-semibold text-slate-900 dark:text-white">
                  {currency} {charge.amount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stay details + Hotel Information */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
              <BedDouble size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Stay Details</h3>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">Confirmation</span>
              <span className="font-medium text-slate-900 dark:text-white">{reservation?.id || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">Check-in</span>
              <span className="font-medium text-slate-900 dark:text-white">{formatDate(reservation?.checkInDate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">Check-out</span>
              <span className="font-medium text-slate-900 dark:text-white">{formatDate(reservation?.checkOutDate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">Guests</span>
              <span className="font-medium text-slate-900 dark:text-white">{reservation?.guests ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">Nightly Rate</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {reservation?.rate ? `${currency} ${Number(reservation.rate).toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">Payment</span>
              <span className="font-medium text-slate-900 dark:text-white">{reservation?.paymentStatus || '—'}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
              <Info size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Hotel Information</h3>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Hotel Name</div>
              <div className="font-medium text-slate-900 dark:text-white">
                {property?.name || '—'}
                {property?.starRating ? <span className="text-amber-500 ml-1">{'★'.repeat(Math.min(5, property.starRating))}</span> : null}
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Address</div>
              <div className="font-medium text-slate-900 dark:text-white">{formatAddress(property?.address)}</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-sm text-slate-500 dark:text-slate-400">Phone</div>
                <div className="font-medium text-slate-900 dark:text-white">{property?.phone || '—'}</div>
              </div>
              <div className="flex-1">
                <div className="text-sm text-slate-500 dark:text-slate-400">Email</div>
                <div className="font-medium text-slate-900 dark:text-white">{property?.email || '—'}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-sm text-slate-500 dark:text-slate-400">Check-in</div>
                <div className="font-medium text-slate-900 dark:text-white">{property?.checkInTime || '3:00 PM'}</div>
              </div>
              <div className="flex-1">
                <div className="text-sm text-slate-500 dark:text-slate-400">Check-out</div>
                <div className="font-medium text-slate-900 dark:text-white">{property?.checkOutTime || '11:00 AM'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Itinerary */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
            <Calendar size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Today's Itinerary</h3>
        </div>

        {itinerary.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <Calendar size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing booked for today — spa and dining reservations you make will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {itinerary.map((item) => (
              <div key={item.id} className="flex items-start gap-4 p-4 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                <div className="flex-shrink-0 flex items-center gap-2">
                  {itineraryIcon(item)}
                  <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{item.time}</div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-slate-900 dark:text-white">{item.activity}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">{item.location}</div>
                  {item.description && (
                    <div className="text-sm text-slate-500 dark:text-slate-500 mt-1">{item.description}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Emergency Contacts */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-red-200 dark:border-red-700/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center">
            <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Emergency Contacts</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Front Desk</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">24/7 reception</div>
            </div>
            <div className="flex items-center gap-2">
              <Phone size={18} className="text-red-600 dark:text-red-400" />
              <span className="font-bold text-slate-900 dark:text-white">{property?.phone || '0'}</span>
            </div>
          </div>
          {EMERGENCY_DIRECTORY.map((contact) => (
            <div key={contact.name} className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">{contact.name}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">{contact.description}</div>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={18} className="text-red-600 dark:text-red-400" />
                <span className="font-bold text-slate-900 dark:text-white">{contact.phone}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MyStayModule;
