/**
 * Spa & Wellness Booking Module
 * Public catalog backed by /api/public/spa-treatments; booking requests post
 * to /api/public/spa-booking-requests and land in the spa portal as
 * 'Requested' appointments for staff to confirm.
 */

import { useEffect, useState } from 'react';
import { Sparkles, Clock, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { ModuleHeader, HERO } from '../shared';

interface Treatment {
  id: string;
  name: string;
  category: string;
  duration: string;
  price: number;
  popular?: boolean;
  description: string;
}

const SpaWellnessBookingModule: React.FC = () => {
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Treatment | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', date: '', time: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/public/spa-treatments')
      .then(r => r.json())
      .then(j => setTreatments(j.treatments || []))
      .catch(() => setError('Could not load treatments'))
      .finally(() => setLoading(false));
  }, []);

  const submitRequest = async () => {
    if (!selected) return;
    if (!form.name.trim() || !form.date || !form.time) {
      setFormError('Name, date and time are required');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/public/spa-booking-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          treatment_id: selected.id,
          preferred_date: form.date,
          preferred_time: form.time,
          notes: form.notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setBooked(json.booking?.id || 'submitted');
    } catch (e: any) {
      setFormError(e.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const closeModal = () => {
    setSelected(null);
    setBooked(null);
    setFormError(null);
    setForm({ name: '', phone: '', email: '', date: '', time: '', notes: '' });
  };

  return (
    <div className="[&>*+*]:mt-8">
      <ModuleHeader image={HERO.spa} title="Spa & Wellness" subtitle="Relax and rejuvenate with our premium spa treatments" gradient="from-purple-700 to-indigo-900" />

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-stone-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading treatments...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {treatments.map((treatment) => (
            <div key={treatment.id} className="bg-white dark:bg-stone-800 rounded-3xl p-6 shadow-sm border border-stone-200/70 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-xl font-bold text-stone-900 dark:text-white">{treatment.name}</h3>
                {treatment.popular && (
                  <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
                    <Sparkles size={12} /> Popular
                  </span>
                )}
              </div>
              {treatment.description && (
                <p className="text-sm text-stone-500 dark:text-stone-400 mb-3">{treatment.description}</p>
              )}
              <div className="space-y-2 text-sm text-stone-600 dark:text-stone-400 mb-4">
                <div className="flex items-center gap-2">
                  <Clock size={16} />
                  <span>{treatment.duration}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-purple-600">${treatment.price}</span>
                <button
                  onClick={() => setSelected(treatment)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-full font-semibold transition-colors"
                >
                  Book Now
                </button>
              </div>
            </div>
          ))}
          {!treatments.length && !error && (
            <p className="text-stone-400 col-span-full text-center py-8">No treatments available right now.</p>
          )}
        </div>
      )}

      {/* Booking request modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 md:p-8 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            {booked ? (
              <div className="text-center py-6">
                <CheckCircle size={48} className="mx-auto text-emerald-500 mb-4" />
                <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-2">Request received</h3>
                <p className="text-sm text-stone-500 dark:text-stone-400 mb-1">
                  Reference <span className="font-mono font-medium">{booked}</span>
                </p>
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  Our spa team will confirm your appointment shortly.
                </p>
                <button
                  onClick={closeModal}
                  className="mt-6 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-4">
                  Request {selected.name}
                </h3>
                {formError && (
                  <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg text-red-700 dark:text-red-400 text-sm">
                    <AlertTriangle size={16} /> {formError}
                  </div>
                )}
                <div className="space-y-3">
                  <input
                    type="text" placeholder="Full name *" value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-white text-sm"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="tel" placeholder="Phone" value={form.phone}
                      onChange={e => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-white text-sm"
                    />
                    <input
                      type="email" placeholder="Email" value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-white text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="date" min={new Date().toISOString().slice(0, 10)} value={form.date}
                      onChange={e => setForm({ ...form, date: e.target.value })}
                      className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-white text-sm"
                    />
                    <input
                      type="time" value={form.time}
                      onChange={e => setForm({ ...form, time: e.target.value })}
                      className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-white text-sm"
                    />
                  </div>
                  <textarea
                    rows={2} placeholder="Notes (optional)" value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-900 dark:text-white text-sm"
                  />
                  <div className="flex justify-between items-center p-3 bg-stone-50 dark:bg-stone-900/30 rounded-lg">
                    <span className="text-sm text-stone-500">{selected.duration}</span>
                    <span className="text-lg font-bold text-purple-600">${selected.price}</span>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-5">
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 border border-stone-200 dark:border-stone-700 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitRequest}
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm font-medium disabled:opacity-50"
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    Request Booking
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SpaWellnessBookingModule;
