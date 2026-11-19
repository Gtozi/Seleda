/**
 * Loyalty Program Module
 * Membership tier, points balance, earn/redeem history.
 *
 * DB-integrated: balance from guests.loyalty_points and the
 * `loyalty_transactions` ledger via GET /api/guest-portal/loyalty/:guestId.
 * Redemption requests go to the concierge queue (`guest_requests`) so staff
 * can apply them against the folio — there is no self-serve rewards catalog
 * in the schema.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Star,
  Award,
  Gift,
  Crown,
  CheckCircle2,
  ArrowRight,
  Loader2,
  AlertCircle,
  Send,
  Gem
} from 'lucide-react';

interface LoyaltyProgramModuleProps {
  guestId?: string;
  reservationId?: string;
}

interface LoyaltyTxn {
  id: string;
  transaction_type: string;
  points: number;
  balance_after: number | null;
  description: string | null;
  created_at: string;
}

interface LoyaltyData {
  balance: number;
  tier: string;
  memberSince: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  nextTier: { name: string; threshold: number } | null;
  transactions: LoyaltyTxn[];
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const TIER_DISPLAY: Record<string, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};

const LoyaltyProgramModule: React.FC<LoyaltyProgramModuleProps> = ({
  guestId,
  reservationId
}) => {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(500);
  const [redeemReason, setRedeemReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const qs = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
      const res = await fetch(`/api/guest-portal/loyalty/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(), credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load loyalty status (${res.status})`);
      setData(payload);
    } catch (e: any) {
      setError(e?.message || 'Failed to load loyalty status');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadData(); }, [loadData]);

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'platinum': return <Crown size={32} />;
      case 'gold': return <Award size={32} />;
      default: return <Star size={32} />;
    }
  };

  const getTierColor = (tier: string) => {
    const colors: Record<string, string> = {
      'silver': 'from-slate-400 to-slate-500',
      'gold': 'from-amber-400 to-amber-500',
      'platinum': 'from-slate-300 to-slate-400',
      'bronze': 'from-amber-700 to-amber-800',
    };
    return colors[tier] || colors['bronze'];
  };

  const handleRedeemRequest = async () => {
    if (!guestId || !redeemReason.trim() || submitting || !data) return;
    if (redeemPoints <= 0 || redeemPoints > data.balance) {
      setModalError(`Enter an amount between 1 and ${data.balance}`);
      return;
    }
    try {
      setSubmitting(true);
      setModalError(null);
      const res = await fetch('/api/guest-portal/concierge/requests', {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          guest_id: guestId,
          reservation_id: reservationId || undefined,
          service_name: 'Loyalty Redemption',
          request_details: `Redeem ${redeemPoints.toLocaleString()} points — ${redeemReason.trim()}`,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
      setShowRedeemModal(false);
      setRedeemReason('');
      setRedeemPoints(500);
      await loadData();
    } catch (e: any) {
      setModalError(e?.message || 'Failed to submit redemption request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Loyalty Program</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your membership benefits and rewards
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Award size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to view your loyalty status</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to see your tier, points balance and activity.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading loyalty status...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error || 'Could not load loyalty status'}
        </div>
      </div>
    );
  }

  const tierName = TIER_DISPLAY[data.tier] || data.tier;
  const progressPct = data.nextTier
    ? Math.min(100, (data.balance / data.nextTier.threshold) * 100)
    : 100;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Loyalty Program</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your membership benefits and rewards
          </p>
        </div>
        {data.balance > 0 && (
          <button
            onClick={() => { setModalError(null); setShowRedeemModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
          >
            <Gift size={16} />
            Redeem Points
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Membership Card */}
      <div className={`bg-gradient-to-br ${getTierColor(data.tier)} rounded-xl p-4 sm:p-6 text-white`}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-sm font-medium opacity-90 mb-1">Membership Tier</div>
            <div className="flex items-center gap-3">
              {getTierIcon(data.tier)}
              <h2 className="text-3xl font-bold">{tierName}</h2>
            </div>
          </div>
          {data.memberSince && (
            <div className="text-right">
              <div className="text-sm font-medium opacity-90 mb-1">Member Since</div>
              <div className="text-lg font-semibold">
                {new Date(data.memberSince).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
            <div className="text-xs opacity-75 mb-1">Points Balance</div>
            <div className="text-2xl font-bold">{data.balance.toLocaleString()}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
            <div className="text-xs opacity-75 mb-1">Points Earned</div>
            <div className="text-2xl font-bold">{data.pointsEarned.toLocaleString()}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3 backdrop-blur">
            <div className="text-xs opacity-75 mb-1">Points Redeemed</div>
            <div className="text-2xl font-bold">{data.pointsRedeemed.toLocaleString()}</div>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="opacity-90">
              {data.nextTier ? `Progress to ${TIER_DISPLAY[data.nextTier.name]}` : 'Top tier reached'}
            </span>
            <span className="font-medium">
              {data.nextTier
                ? `${data.balance.toLocaleString()} / ${data.nextTier.threshold.toLocaleString()} points`
                : `${data.balance.toLocaleString()} points`}
            </span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-2">
            <div
              className="bg-white h-2 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Redeem CTA */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0">
            <Gem size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Redeem your points</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              Points can be applied toward room upgrades, dining, spa treatments and more.
              Submit a redemption request and our concierge team will apply it to your stay.
            </p>
            <button
              onClick={() => { setModalError(null); setShowRedeemModal(true); }}
              disabled={data.balance <= 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Request Redemption
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Points History — real ledger */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Points Activity</h3>
        <div className="space-y-3">
          {data.transactions.map((txn) => (
            <div key={txn.id} className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">
                  {txn.description || (txn.points > 0 ? 'Points earned' : 'Points redeemed')}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {new Date(txn.created_at).toLocaleDateString()}
                  {txn.balance_after != null && ` · Balance ${txn.balance_after.toLocaleString()}`}
                </div>
              </div>
              <div className={`font-semibold ${txn.points > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {txn.points > 0 ? '+' : ''}{txn.points.toLocaleString()}
              </div>
            </div>
          ))}
          {!data.transactions.length && (
            <div className="text-center py-8">
              <CheckCircle2 size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No points activity yet — points are awarded automatically when you check out.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Redeem Modal */}
      {showRedeemModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Request Points Redemption
            </h3>
            {modalError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertCircle size={16} /> {modalError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Points to redeem <span className="font-normal text-slate-400">(balance: {data.balance.toLocaleString()})</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={data.balance}
                  step="50"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What would you like to use them for?
                </label>
                <textarea
                  value={redeemReason}
                  onChange={(e) => setRedeemReason(e.target.value)}
                  placeholder="e.g. Apply to my room bill, dining credit, spa treatment..."
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowRedeemModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleRedeemRequest}
                disabled={!redeemReason.trim() || submitting}
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

export default LoyaltyProgramModule;
