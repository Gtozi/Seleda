/**
 * Maintenance Requests Module
 * Report issues like AC, TV, lighting, plumbing, Wi-Fi, safe, electrical problems, furniture damage.
 *
 * DB-integrated: reads/writes the shared `guest_requests` queue
 * (assigned_department='Engineering') via /api/guest-portal/maintenance/* —
 * the same rows engineering/front-office staff pick up.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Wrench,
  Thermometer,
  Tv,
  Lightbulb,
  Droplets,
  Wifi,
  Lock,
  Zap,
  Armchair,
  Plus,
  Clock,
  CheckCircle2,
  Send,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface MaintenanceRequestsModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface MaintenanceRequest {
  id: string;
  request_number: string | null;
  type: string;
  description: string;
  priority: string;
  status: 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
  submittedAt: string;
  completedAt?: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const STATUS_LABEL: Record<string, MaintenanceRequest['status']> = {
  Open: 'Open',
  Assigned: 'In Progress',
  'In Progress': 'In Progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

const MaintenanceRequestsModule: React.FC<MaintenanceRequestsModuleProps> = ({
  reservationId,
  guestId
}) => {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [resolvedReservationId, setResolvedReservationId] = useState<string | undefined>(reservationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noStay, setNoStay] = useState(false);

  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const issueTypes = [
    { id: 'ac', name: 'Air Conditioning', icon: <Thermometer size={20} /> },
    { id: 'tv', name: 'Television', icon: <Tv size={20} /> },
    { id: 'lighting', name: 'Lighting', icon: <Lightbulb size={20} /> },
    { id: 'plumbing', name: 'Plumbing', icon: <Droplets size={20} /> },
    { id: 'wifi', name: 'Wi-Fi', icon: <Wifi size={20} /> },
    { id: 'safe', name: 'Safe', icon: <Lock size={20} /> },
    { id: 'electrical', name: 'Electrical Problems', icon: <Zap size={20} /> },
    { id: 'furniture', name: 'Furniture Damage', icon: <Armchair size={20} /> }
  ];

  const loadRequests = useCallback(async (resvId: string) => {
    const res = await fetch(
      `/api/guest-portal/maintenance/requests/${encodeURIComponent(resvId)}?reservationId=${encodeURIComponent(resvId)}`,
      { headers: authHeaders(), credentials: 'include' }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `Failed to load requests (${res.status})`);
    setRequests((payload.requests || []).map((r: any) => ({
      id: r.id,
      request_number: r.request_number,
      // Server stores "IssueType · description" in description with
      // request_type='Maintenance'; split the prefix back out for display.
      type: (r.description || '').split(' · ')[0] || r.request_type || 'Maintenance',
      description: (r.description || '').split(' · ').slice(1).join(' · ') || r.description || '',
      priority: r.priority || 'Normal',
      status: STATUS_LABEL[r.status] || 'Open',
      submittedAt: r.submitted_at || r.created_at,
      completedAt: r.completed_at || undefined,
    })));
  }, []);

  const loadData = useCallback(async () => {
    if (!guestId && !reservationId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setNoStay(false);

      let resvId = reservationId;
      if (!resvId && guestId) {
        const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}`, {
          headers: authHeaders(), credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Failed to resolve stay (${res.status})`);
        const rows: any[] = payload.reservations || [];
        const today = new Date().toISOString().slice(0, 10);
        const inHouse = rows.find(r => r.status === 'CheckedIn')
          || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status)
              && r.checkInDate <= today && r.checkOutDate >= today)[0]
          || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status))
              .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0];
        resvId = inHouse?.id;
      }

      if (!resvId) {
        setResolvedReservationId(undefined);
        setRequests([]);
        setNoStay(true);
        return;
      }
      setResolvedReservationId(resvId);
      await loadRequests(resvId);
    } catch (e: any) {
      setError(e?.message || 'Failed to load maintenance requests');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId, loadRequests]);

  useEffect(() => { loadData(); }, [loadData]);

  const getStatusColor = (status: string) => {
    const colors = {
      'Open': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'In Progress': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400',
      'Completed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
    };
    return colors[status as keyof typeof colors] || colors['Open'];
  };

  const getPriorityColor = (p: string) => {
    return p === 'Urgent' || p === 'High'
      ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400'
      : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/50 dark:text-slate-400';
  };

  const handleSubmitRequest = async () => {
    if (!selectedType || !requestDescription.trim() || !resolvedReservationId || submitting) return;
    try {
      setSubmitting(true);
      setFormError(null);
      const res = await fetch('/api/guest-portal/maintenance/requests', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          reservationId: resolvedReservationId,
          issueType: issueTypes.find(t => t.id === selectedType)?.name || selectedType,
          description: requestDescription.trim(),
          priority,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);

      setShowNewRequestModal(false);
      setSelectedType('');
      setRequestDescription('');
      setPriority('Normal');
      await loadRequests(resolvedReservationId);
    } catch (e: any) {
      setFormError(e?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!confirm('Are you sure you want to cancel this request?') || cancelling) return;
    try {
      setCancelling(requestId);
      const res = await fetch(`/api/guest-portal/maintenance/requests/${encodeURIComponent(requestId)}/cancel`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: resolvedReservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Cancel failed (${res.status})`);
      setRequests(prev => prev.map(r =>
        r.id === requestId ? { ...r, status: 'Cancelled' as const } : r
      ));
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel request');
    } finally {
      setCancelling(null);
    }
  };

  if (!guestId && !reservationId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Maintenance Requests</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Report maintenance issues in your room
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Wrench size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to report an issue</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to submit and track maintenance requests.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading requests...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Maintenance Requests</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Report maintenance issues in your room
          </p>
        </div>
        <button
          onClick={() => setShowNewRequestModal(true)}
          disabled={!resolvedReservationId}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={16} />
          Report Issue
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {noStay && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
          <AlertCircle size={16} />
          No reservation is linked to your profile — maintenance requests need an active stay.
        </div>
      )}

      {/* Issue Types */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {issueTypes.map((type) => (
          <button
            key={type.id}
            onClick={() => {
              setSelectedType(type.id);
              setFormError(null);
              setShowNewRequestModal(true);
            }}
            disabled={!resolvedReservationId}
            className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md transition text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/20 rounded-lg flex items-center justify-center text-amber-600 dark:text-amber-400 mb-3">
              {type.icon}
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white">{type.name}</h3>
          </button>
        ))}
      </div>

      {/* My Requests */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">My Requests</h3>
        <div className="space-y-3">
          {requests.map((request) => (
            <div key={request.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h4 className="font-medium text-slate-900 dark:text-white">{request.type}</h4>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(request.status)}`}>
                      {request.status}
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(request.priority)}`}>
                      {request.priority}
                    </div>
                    {request.request_number && (
                      <span className="text-xs text-slate-400 font-mono">{request.request_number}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{request.description}</p>
                  <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      <span>Submitted: {new Date(request.submittedAt).toLocaleString()}</span>
                    </div>
                    {request.completedAt && (
                      <div className="flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        <span>Completed: {new Date(request.completedAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
                {request.status === 'Open' && (
                  <button
                    onClick={() => handleCancelRequest(request.id)}
                    disabled={cancelling === request.id}
                    className="ml-4 p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                  >
                    {cancelling === request.id ? <Loader2 size={14} className="animate-spin" /> : '✕'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {requests.length === 0 && !noStay && (
            <p className="py-4 sm:py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No requests yet — tap an issue type above to report a problem.
            </p>
          )}
        </div>
      </div>

      {/* New Request Modal */}
      {showNewRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Report Maintenance Issue</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Issue Type
                </label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select an issue type...</option>
                  {issueTypes.map(type => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Description
                </label>
                <textarea
                  value={requestDescription}
                  onChange={(e) => setRequestDescription(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Priority
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      value="Normal"
                      checked={priority === 'Normal'}
                      onChange={() => setPriority('Normal')}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Normal</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      value="Urgent"
                      checked={priority === 'Urgent'}
                      onChange={() => setPriority('Urgent')}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Urgent</span>
                  </label>
                </div>
              </div>
              {formError && (
                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowNewRequestModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitRequest}
                disabled={!selectedType || !requestDescription.trim() || submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaintenanceRequestsModule;
