/**
 * Help Center Module
 * FAQs from `guest_faqs` (global + property-scoped) and real property
 * contact details, loaded via GET /api/guest-portal/help/:guestId.
 * "Start Chat" and the quick links navigate to real portal modules.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  HelpCircle,
  Search,
  Phone,
  Mail,
  MessageSquare,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Loader2,
  Bed,
  UtensilsCrossed,
  Car,
  ConciergeBell
} from 'lucide-react';

interface HelpCenterModuleProps {
  reservationId?: string;
  guestId?: string;
}

interface Faq {
  id: string;
  question: string;
  answer: string;
  category: string;
}

interface HelpProperty {
  name: string;
  phone: string | null;
  email: string | null;
  checkInTime: string;
  checkOutTime: string;
  emergencyContacts?: Record<string, string> | null;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const HelpCenterModule: React.FC<HelpCenterModuleProps> = ({
  reservationId,
  guestId
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [property, setProperty] = useState<HelpProperty | null>(null);
  const [resolvedReservationId, setResolvedReservationId] = useState<string | undefined>(reservationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const goToModule = (slug: string) => {
    navigate({
      pathname: `/guest/${slug}`,
      search: searchParams.toString() ? `?${searchParams.toString()}` : '',
    });
  };

  const loadHelp = useCallback(async () => {
    if (!guestId) {
      setFaqs([]);
      setProperty(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      let resvId = reservationId;
      if (!resvId) {
        // Needed as the canActForGuest credential — in-house stay first,
        // else soonest upcoming.
        const res = await fetch(`/api/guest-portal/reservations/${encodeURIComponent(guestId)}`, {
          headers: authHeaders(), credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const rows: any[] = payload.reservations || [];
          const today = new Date().toISOString().slice(0, 10);
          resvId = rows.find(r => r.status === 'CheckedIn')?.id
            || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status)
                && r.checkInDate <= today && r.checkOutDate >= today)[0]?.id
            || rows.filter(r => ['Reserved', 'Pending', 'Confirmed'].includes(r.status))
                .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0]?.id;
        }
      }
      setResolvedReservationId(resvId);

      const qs = resvId ? `?reservationId=${encodeURIComponent(resvId)}` : '';
      const res = await fetch(`/api/guest-portal/help/${encodeURIComponent(guestId)}${qs}`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to load help (${res.status})`);
      setFaqs(payload.faqs || []);
      setProperty(payload.property || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load help');
    } finally {
      setLoading(false);
    }
  }, [guestId, reservationId]);

  useEffect(() => { loadHelp(); }, [loadHelp]);

  const categories = ['All', ...Array.from(new Set(faqs.map(f => f.category)))];

  const filteredFAQs = faqs.filter(faq => {
    const matchesSearch = faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         faq.answer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const toggleFAQ = (faqId: string) => {
    setExpandedFAQ(expandedFAQ === faqId ? null : faqId);
  };

  // Emergency contacts: property metadata wins, else sensible ET defaults.
  const emergency = property?.emergencyContacts || {};
  const emergencyContacts = [
    { label: 'Front Desk', sub: '24/7 Reception', number: emergency.front_desk || '0' },
    { label: 'Security', sub: 'Emergency Security', number: emergency.security || '911' },
    { label: 'Medical', sub: 'Ambulance', number: emergency.medical || '907' },
    { label: 'Fire', sub: 'Fire Department', number: emergency.fire || '939' },
  ];

  if (!guestId) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 sm:p-12 text-center">
          <HelpCircle className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Sign in required</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in to see help content for your hotel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Help Center</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Find answers to common questions and get support
          {property?.name ? ` at ${property.name}` : ''}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} />
          {error}
          <button onClick={loadHelp} className="ml-auto underline">Retry</button>
        </div>
      )}

      {/* Search */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search for help..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Contact Options — real property contact details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6 text-center">
          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto mb-3">
            <Phone size={24} />
          </div>
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Front Desk</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Dial 0 from your room</p>
          {property?.phone ? (
            <a
              href={`tel:${property.phone}`}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {property.phone}
            </a>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-500">Contact via the Messages tab</p>
          )}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6 text-center">
          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto mb-3">
            <MessageSquare size={24} />
          </div>
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Message the Hotel</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Front desk &amp; concierge reply here</p>
          <button
            onClick={() => goToModule('messaging')}
            disabled={!resolvedReservationId && !guestId}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50"
          >
            Open Messages
          </button>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6 text-center">
          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400 mx-auto mb-3">
            <Mail size={24} />
          </div>
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Email Support</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">We reply as soon as possible</p>
          {property?.email ? (
            <a
              href={`mailto:${property.email}`}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {property.email}
            </a>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-500">No email on file</p>
          )}
        </div>
      </div>

      {property && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Check-in {property.checkInTime} · Check-out {property.checkOutTime}
        </p>
      )}

      {/* Category Filter — derived from the live FAQ set */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                selectedCategory === category
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      )}

      {/* FAQs */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Frequently Asked Questions</h3>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : filteredFAQs.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {faqs.length === 0 ? 'No help articles published yet.' : 'No results match your search.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFAQs.map((faq) => (
              <div key={faq.id} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleFAQ(faq.id)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <HelpCircle size={16} />
                    </div>
                    <span className="font-medium text-slate-900 dark:text-white">{faq.question}</span>
                  </div>
                  {expandedFAQ === faq.id ? (
                    <ChevronUp size={20} className="text-slate-400" />
                  ) : (
                    <ChevronDown size={20} className="text-slate-400" />
                  )}
                </button>
                {expandedFAQ === faq.id && (
                  <div className="p-4 pt-0 border-t border-slate-200 dark:border-slate-700">
                    <p className="text-sm text-slate-600 dark:text-slate-400">{faq.answer}</p>
                    <div className="mt-2">
                      <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded text-xs">
                        {faq.category}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Emergency Contacts */}
      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-700/50 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center text-red-600 dark:text-red-400">
            <AlertTriangle size={20} />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Emergency Contacts</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {emergencyContacts.map((c) => (
            <div key={c.label} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">{c.label}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">{c.sub}</div>
              </div>
              <div className="text-lg font-bold text-red-600 dark:text-red-400">{c.number}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Links — real portal modules */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Links</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button
            onClick={() => goToModule('my-stay')}
            className="flex items-center gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
          >
            <Bed size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">My Stay</span>
          </button>
          <button
            onClick={() => goToModule('restaurant')}
            className="flex items-center gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
          >
            <UtensilsCrossed size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Dining</span>
          </button>
          <button
            onClick={() => goToModule('transportation')}
            className="flex items-center gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
          >
            <Car size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Transport</span>
          </button>
          <button
            onClick={() => goToModule('concierge')}
            className="flex items-center gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/20 transition"
          >
            <ConciergeBell size={18} className="text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Concierge</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default HelpCenterModule;
