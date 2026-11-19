/**
 * Wallet & Payments Module
 * Saved card-on-file references and real folio payment history.
 *
 * DB-integrated: methods persist to `guest_payment_methods` (display
 * metadata only — never PAN/CVV) and history comes from `folio_payments`
 * across the guest's reservations via /api/guest-portal/wallet/*.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CreditCard,
  Wallet,
  Plus,
  Trash2,
  CheckCircle2,
  DollarSign,
  Smartphone,
  Building,
  Gift,
  Loader2,
  AlertCircle,
  Send
} from 'lucide-react';

interface WalletPaymentsModuleProps {
  guestId?: string;
  reservationId?: string;
}

interface PaymentMethod {
  id: string;
  type: 'CreditCard' | 'DebitCard' | 'MobileWallet' | 'BankTransfer' | 'CorporateAccount' | 'GiftCard';
  name: string;
  lastFour: string | null;
  expiryDate?: string | null;
  isDefault: boolean;
}

interface Payment {
  id: string;
  amount: number;
  date: string;
  description: string;
  method: string | null;
  reference: string | null;
  status: 'Completed' | 'Pending' | 'Failed' | 'Refunded';
}

function authHeaders(json = false): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

const WalletPaymentsModule: React.FC<WalletPaymentsModuleProps> = ({
  guestId,
  reservationId
}) => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [newPaymentMethod, setNewPaymentMethod] = useState({
    type: 'CreditCard',
    name: '',
    lastFour: '',
    expiryDate: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const qs = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : '';
      const res = await fetch(`/api/guest-portal/wallet/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(), credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load wallet (${res.status})`);
      setPaymentMethods(payload.methods || []);
      setPayments(payload.payments || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadData(); }, [loadData]);

  const getPaymentMethodIcon = (type: string) => {
    switch (type) {
      case 'CreditCard':
      case 'DebitCard': return <CreditCard size={20} />;
      case 'MobileWallet': return <Smartphone size={20} />;
      case 'BankTransfer': return <Building size={20} />;
      case 'CorporateAccount': return <Building size={20} />;
      case 'GiftCard': return <Gift size={20} />;
      default: return <CreditCard size={20} />;
    }
  };

  const getStatusColor = (status: string) => {
    const colors = {
      'Completed': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/50 dark:text-emerald-400',
      'Pending': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-400',
      'Failed': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:border-red-700/50 dark:text-red-400',
      'Refunded': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/50 dark:text-blue-400'
    };
    return colors[status as keyof typeof colors] || colors['Pending'];
  };

  const handleSetDefault = async (paymentMethodId: string) => {
    if (busyId) return;
    try {
      setBusyId(paymentMethodId);
      const res = await fetch(`/api/guest-portal/wallet/methods/${encodeURIComponent(paymentMethodId)}/default`, {
        method: 'PATCH',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: reservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed (${res.status})`);
      setPaymentMethods(prev => prev.map(pm => ({ ...pm, isDefault: pm.id === paymentMethodId })));
    } catch (e: any) {
      setError(e?.message || 'Could not set default');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeletePaymentMethod = async (paymentMethodId: string) => {
    if (!confirm('Are you sure you want to remove this payment method?') || busyId) return;
    try {
      setBusyId(paymentMethodId);
      const res = await fetch(`/api/guest-portal/wallet/methods/${encodeURIComponent(paymentMethodId)}`, {
        method: 'DELETE',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reservationId: reservationId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Delete failed (${res.status})`);
      await loadData();
    } catch (e: any) {
      setError(e?.message || 'Could not remove payment method');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddPaymentMethod = async () => {
    if (!guestId || submitting) return;
    if (!newPaymentMethod.name.trim()) {
      setModalError('Please enter a name for this payment method');
      return;
    }
    if (newPaymentMethod.lastFour && !/^\d{4}$/.test(newPaymentMethod.lastFour)) {
      setModalError('Last 4 digits must be exactly 4 digits');
      return;
    }
    try {
      setSubmitting(true);
      setModalError(null);
      const res = await fetch(`/api/guest-portal/wallet/${encodeURIComponent(guestId)}/methods`, {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          reservation_id: reservationId || undefined,
          method_type: newPaymentMethod.type,
          label: newPaymentMethod.name.trim(),
          last_four: newPaymentMethod.lastFour || undefined,
          expiry: newPaymentMethod.expiryDate || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed (${res.status})`);
      setShowAddPaymentModal(false);
      setNewPaymentMethod({ type: 'CreditCard', name: '', lastFour: '', expiryDate: '' });
      await loadData();
    } catch (e: any) {
      setModalError(e?.message || 'Could not save payment method');
    } finally {
      setSubmitting(false);
    }
  };

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Wallet & Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage your payment methods and view payment history
          </p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <Wallet size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in to view your wallet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Link a guest profile to manage payment methods and see payment history.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading wallet...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Wallet & Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage your payment methods and view payment history
          </p>
        </div>
        <button
          onClick={() => { setModalError(null); setShowAddPaymentModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
        >
          <Plus size={16} />
          Add Payment Method
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Payment Methods */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Payment Methods</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Card-on-file references saved for faster checkout at the front desk — card numbers are never stored here.
        </p>
        <div className="space-y-3">
          {paymentMethods.map((method) => (
            <div key={method.id} className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  {getPaymentMethodIcon(method.type)}
                </div>
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">{method.name}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {method.lastFour ? `•••• ${method.lastFour}` : ''}
                    {method.lastFour && method.expiryDate ? ' · ' : ''}
                    {method.expiryDate ? `Expires ${method.expiryDate}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {method.isDefault ? (
                  <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-sm">
                    <CheckCircle2 size={16} />
                    <span>Default</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleSetDefault(method.id)}
                    disabled={busyId === method.id}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50"
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => handleDeletePaymentMethod(method.id)}
                  disabled={busyId === method.id}
                  className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition disabled:opacity-50"
                >
                  {busyId === method.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                </button>
              </div>
            </div>
          ))}
          {!paymentMethods.length && (
            <p className="py-4 sm:py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No payment methods saved yet — add one to speed up checkout.
            </p>
          )}
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Payment History</h3>
        <div className="space-y-3">
          {payments.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/20">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center">
                  <DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">{payment.description}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {[payment.method, new Date(payment.date).toLocaleDateString(), payment.reference]
                      .filter(Boolean).join(' • ')}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(payment.status)}`}>
                  {payment.status}
                </div>
                <div className="font-semibold text-slate-900 dark:text-white mt-1">
                  ${payment.amount.toFixed(2)}
                </div>
              </div>
            </div>
          ))}
          {!payments.length && (
            <p className="py-4 sm:py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No payments recorded yet — charges you settle at the desk will appear here.
            </p>
          )}
        </div>
      </div>

      {/* Add Payment Method Modal */}
      {showAddPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Add Payment Method</h3>
            {modalError && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <AlertCircle size={16} /> {modalError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Payment Type
                </label>
                <select
                  value={newPaymentMethod.type}
                  onChange={(e) => setNewPaymentMethod({ ...newPaymentMethod, type: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="CreditCard">Credit Card</option>
                  <option value="DebitCard">Debit Card</option>
                  <option value="MobileWallet">Mobile Wallet</option>
                  <option value="BankTransfer">Bank Transfer</option>
                  <option value="CorporateAccount">Corporate Account</option>
                  <option value="GiftCard">Gift Card</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Name on Card/Account
                </label>
                <input
                  type="text"
                  value={newPaymentMethod.name}
                  onChange={(e) => setNewPaymentMethod({ ...newPaymentMethod, name: e.target.value })}
                  placeholder="Enter name"
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Last 4 Digits <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={newPaymentMethod.lastFour}
                  onChange={(e) => setNewPaymentMethod({ ...newPaymentMethod, lastFour: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="1234"
                  maxLength={4}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {(newPaymentMethod.type === 'CreditCard' || newPaymentMethod.type === 'DebitCard') && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Expiry Date
                  </label>
                  <input
                    type="month"
                    value={newPaymentMethod.expiryDate}
                    onChange={(e) => setNewPaymentMethod({ ...newPaymentMethod, expiryDate: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddPaymentModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAddPaymentMethod}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Save Method
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletPaymentsModule;
