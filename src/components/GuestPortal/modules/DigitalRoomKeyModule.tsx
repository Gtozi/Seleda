/**
 * Digital Room Key Module
 * Mobile key activation, key sharing, lost-device revocation.
 * Live data: digital_keys rows via /api/guest-portal/digital-key/*.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Key,
  Smartphone,
  Share2,
  Clock,
  AlertTriangle,
  AlertCircle,
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  User,
  Calendar,
  DoorOpen
} from 'lucide-react';

interface DigitalRoomKeyModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface DigitalKey {
  id: string;
  kind: 'device' | 'shared';
  deviceName?: string | null;
  deviceType?: 'iOS' | 'Android' | null;
  sharedWithName?: string | null;
  sharedRelationship?: string | null;
  status: 'active' | 'expired' | 'revoked';
  issuedAt?: string | null;
  expiresAt?: string | null;
}

interface KeyReservation {
  id: string;
  propertyId?: string;
  guestId?: string;
  guestName?: string;
  roomNumber?: string | null;
  status?: string;
  checkInDate?: string;
  checkOutDate?: string;
}

interface ReservationListItem {
  id: string;
  status?: string;
  checkOutDate?: string;
}

const KEY_ELIGIBLE_STATUSES = new Set(['CheckedIn', 'Checked In', 'InHouse', 'In House']);

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleString();
}

const DigitalRoomKeyModule: React.FC<DigitalRoomKeyModuleProps> = ({
  reservationId: reservationIdProp,
  guestId
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noContext, setNoContext] = useState(false);
  const [noEligible, setNoEligible] = useState(false);
  const [reservationId, setReservationId] = useState(reservationIdProp || '');
  const [reservation, setReservation] = useState<KeyReservation | null>(null);
  const [keys, setKeys] = useState<DigitalKey[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [showShareKeyModal, setShowShareKeyModal] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<'iOS' | 'Android'>('iOS');
  const [shareGuestName, setShareGuestName] = useState('');
  const [shareRelationship, setShareRelationship] = useState('Spouse');

  const loadKeys = useCallback(async (resId: string) => {
    const res = await fetch(`/api/guest-portal/digital-key/${encodeURIComponent(resId)}`, {
      headers: authHeaders(),
      credentials: 'include'
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to load keys (${res.status})`);
    }
    const body = await res.json();
    setKeys(body.keys || []);
    setReservation(body.reservation || null);
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
          const inHouse = list.find(r => KEY_ELIGIBLE_STATUSES.has(String(r.status)));
          const upcoming = list
            .filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(String(r.status)))
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
        if (!cancelled) {
          setReservationId(resId);
          await loadKeys(resId);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load digital keys');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reservationIdProp, guestId, loadKeys]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'active': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'expired': 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400',
      'revoked': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
    };
    return colors[status] || colors['active'];
  };

  const statusLabel = (status: string) =>
    status.charAt(0).toUpperCase() + status.slice(1);

  const handleIssueKey = async () => {
    if (!deviceName.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/digital-key/${encodeURIComponent(reservationId)}/issue`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          deviceName: deviceName.trim(),
          deviceType,
          guestId: reservation?.guestId || guestId
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to issue key (${res.status})`);
      setKeys(prev => [body.key, ...prev]);
      setShowAddKeyModal(false);
      setDeviceName('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to issue key');
    } finally {
      setSubmitting(false);
    }
  };

  const handleShareKey = async () => {
    if (!shareGuestName.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/digital-key/${encodeURIComponent(reservationId)}/share`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          guestName: shareGuestName.trim(),
          relationship: shareRelationship,
          guestId: reservation?.guestId || guestId
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to share key (${res.status})`);
      setKeys(prev => [body.key, ...prev]);
      setShowShareKeyModal(false);
      setShareGuestName('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to share key');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this key?')) return;
    setRevokingId(keyId);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/digital-key/${encodeURIComponent(keyId)}/revoke`, {
        method: 'PATCH',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ reservationId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to revoke key (${res.status})`);
      setKeys(prev => prev.map(k => k.id === keyId ? body.key : k));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  };

  const handleLostDevice = async () => {
    if (!confirm('This will revoke all active keys on this reservation. Continue?')) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/guest-portal/digital-key/${encodeURIComponent(reservationId)}/revoke-all`, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ reservationId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to revoke keys (${res.status})`);
      await loadKeys(reservationId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to revoke keys');
    } finally {
      setSubmitting(false);
    }
  };

  const deviceKeys = keys.filter(k => k.kind === 'device');
  const sharedKeys = keys.filter(k => k.kind === 'shared');
  const activeKeys = deviceKeys.filter(k => k.status === 'active');
  const activeSharedKeys = sharedKeys.filter(k => k.status === 'active');
  const canIssue = KEY_ELIGIBLE_STATUSES.has(String(reservation?.status)) && !!reservation?.roomNumber;

  // ── Render states ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto text-indigo-500 animate-spin mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading digital keys…</p>
        </div>
      </div>
    );
  }

  if (noContext || noEligible) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Digital Room Key</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage your mobile room keys and share access with authorized guests
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Key size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {noContext ? 'Sign in to manage keys' : 'No reservation eligible for a digital key'}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {noContext
              ? 'Link a guest profile to view and manage your room keys.'
              : 'Digital keys are available for current or upcoming stays.'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Digital Room Key</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage your mobile room keys and share access with authorized guests
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Digital keys unavailable</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); loadKeys(reservationId).catch(e => setError(e.message)).finally(() => setLoading(false)); }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Digital Room Key</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {reservation?.roomNumber
              ? `Room ${reservation.roomNumber} · Conf #${reservation.id}`
              : 'Manage your mobile room keys and share access with authorized guests'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleLostDevice}
            disabled={submitting || activeKeys.length === 0}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AlertTriangle size={16} />
            Lost Device
          </button>
          <button
            onClick={() => setShowAddKeyModal(true)}
            disabled={!canIssue}
            title={canIssue ? undefined : 'A key can be issued once your room is assigned at check-in'}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
            Add New Key
          </button>
        </div>
      </div>

      {!canIssue && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700/50">
          <DoorOpen size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {KEY_ELIGIBLE_STATUSES.has(String(reservation?.status))
              ? 'No room has been assigned to this reservation yet — keys can be issued once the front desk assigns your room.'
              : 'Digital keys are issued once your stay begins. Complete check-in first.'}
          </p>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700/50">
          <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{actionError}</p>
        </div>
      )}

      {/* Active Keys Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-4 sm:p-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <Smartphone size={24} />
            <span className="text-sm font-medium opacity-90">Active Keys</span>
          </div>
          <div className="text-3xl font-bold">{activeKeys.length}</div>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-4 sm:p-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <Share2 size={24} />
            <span className="text-sm font-medium opacity-90">Shared Access</span>
          </div>
          <div className="text-3xl font-bold">{activeSharedKeys.length}</div>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl p-4 sm:p-6 text-white">
          <div className="flex items-center gap-3 mb-3">
            <Shield size={24} />
            <span className="text-sm font-medium opacity-90">Security Status</span>
          </div>
          <div className="text-3xl font-bold">Secure</div>
        </div>
      </div>

      {/* My Keys */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">My Keys</h3>
          <button
            onClick={() => setShowAddKeyModal(true)}
            disabled={!canIssue}
            className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
            Add Key
          </button>
        </div>

        {deviceKeys.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <Smartphone size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No keys issued yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deviceKeys.map((key) => (
              <div key={key.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      key.deviceType === 'iOS' ? 'bg-slate-800 text-white' : 'bg-emerald-500 text-white'
                    }`}>
                      <Smartphone size={20} />
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-900 dark:text-white">{key.deviceName || 'Device'}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(key.status)}`}>
                          {statusLabel(key.status)}
                        </span>
                        {key.deviceType && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {key.deviceType}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-1">
                          <Calendar size={12} />
                          <span>Issued: {formatDateTime(key.issuedAt)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          <span>Expires: {formatDateTime(key.expiresAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {key.status === 'active' && (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      disabled={revokingId === key.id}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                    >
                      {revokingId === key.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shared Keys */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Shared Access</h3>
          <button
            onClick={() => setShowShareKeyModal(true)}
            disabled={!canIssue}
            className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Share2 size={16} />
            Share Key
          </button>
        </div>

        {sharedKeys.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
            <Share2 size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400">No shared access yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sharedKeys.map((sharedKey) => (
              <div key={sharedKey.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center">
                      <User size={20} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h4 className="font-medium text-slate-900 dark:text-white">{sharedKey.sharedWithName}</h4>
                      {sharedKey.sharedRelationship && (
                        <div className="text-sm text-slate-600 dark:text-slate-400">{sharedKey.sharedRelationship}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(sharedKey.status)}`}>
                          {statusLabel(sharedKey.status)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-1">
                          <Calendar size={12} />
                          <span>Shared: {formatDateTime(sharedKey.issuedAt)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          <span>Expires: {formatDateTime(sharedKey.expiresAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {sharedKey.status === 'active' && (
                    <button
                      onClick={() => handleRevoke(sharedKey.id)}
                      disabled={revokingId === sharedKey.id}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                    >
                      {revokingId === sharedKey.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Key Modal */}
      {showAddKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Add New Key</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Device Name
                </label>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g., iPhone 15 Pro"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Device Type
                </label>
                <select
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value as 'iOS' | 'Android')}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="iOS">iOS</option>
                  <option value="Android">Android</option>
                </select>
              </div>
              {reservation?.roomNumber && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  The key will be issued for Room {reservation.roomNumber} and expires
                  {reservation.checkOutDate ? ` on ${formatDateTime(reservation.checkOutDate + 'T11:00:00')}` : ' at check-out'}.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddKeyModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleIssueKey}
                disabled={submitting || !deviceName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Activating...
                  </>
                ) : (
                  <>
                    <Key size={16} />
                    Activate Key
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Key Modal */}
      {showShareKeyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Share Key</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Guest Name
                </label>
                <input
                  type="text"
                  value={shareGuestName}
                  onChange={(e) => setShareGuestName(e.target.value)}
                  placeholder="Enter guest name"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Relationship
                </label>
                <select
                  value={shareRelationship}
                  onChange={(e) => setShareRelationship(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Spouse">Spouse</option>
                  <option value="Family Member">Family Member</option>
                  <option value="Friend">Friend</option>
                  <option value="Colleague">Colleague</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowShareKeyModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleShareKey}
                disabled={submitting || !shareGuestName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Share2 size={16} />
                Share Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DigitalRoomKeyModule;
