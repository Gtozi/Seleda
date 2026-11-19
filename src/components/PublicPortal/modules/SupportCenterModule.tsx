/**
 * Support Center Module
 * FAQs plus the hotel's own policies (cancellation, terms) from the admin settings.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, FileText, Shield, ChevronDown, Search, Mail, Phone } from 'lucide-react';
import { ModuleHeader, Reveal, usePublicSettings, HERO } from '../shared';

const SupportCenterModule: React.FC = () => {
  const settings = usePublicSettings();
  const [activeSection, setActiveSection] = useState('faq');
  const [expanded, setExpanded] = useState<number | null>(0);
  const [query, setQuery] = useState('');

  const grace = settings.cancellationGraceHours ?? 24;
  const penalty = settings.cancellationPenaltyPercent ?? 50;
  const hotel = settings.customHotelName || 'the hotel';

  const faqs = useMemo(() => [
    { q: 'What is the cancellation policy?', a: `You can cancel free of charge up to ${grace} hours before check-in. Later cancellations may be charged ${penalty}% of the booking.` },
    { q: 'How do I modify my reservation?', a: 'Sign in to the Guest Portal to change your dates, or contact our reservations team. Changes are subject to availability and rate differences.' },
    { q: 'What payment methods do you accept?', a: 'You can pay online by card or mobile wallet, or choose a bank transfer and send your receipt with your reservation ID.' },
    { q: 'What are check-in and check-out times?', a: `Check-in is from ${settings.checkInTime || 'the afternoon'} and check-out is by ${settings.checkOutTime || 'late morning'}. Early check-in is subject to availability.` },
    { q: 'Do you offer airport transfers?', a: 'Yes. You can add an airport pickup or drop-off when you book your stay, or request transport from the hotel.' },
  ].filter(f => !query.trim() || `${f.q} ${f.a}`.toLowerCase().includes(query.trim().toLowerCase())), [grace, penalty, settings.checkInTime, settings.checkOutTime, query]);

  const policies = settings.policySections || [];
  const sections = [
    { id: 'faq', label: 'FAQs', icon: <HelpCircle size={18} /> },
    { id: 'cancellation', label: 'Cancellation', icon: <FileText size={18} /> },
    { id: 'terms', label: 'Terms & policies', icon: <Shield size={18} /> },
  ];

  return (
    <div className="[&>*+*]:mt-8">
      <ModuleHeader image={HERO.support} title="Help & Support" subtitle="Answers to common questions and our booking policies" gradient="from-stone-700 to-stone-950" />

      <div className="flex gap-2 flex-wrap" role="tablist">
        {sections.map(s => (
          <button key={s.id} role="tab" aria-selected={activeSection === s.id} onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-colors ${activeSection === s.id ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-400'}`}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-3xl p-6 md:p-8 border border-stone-200/70 shadow-sm">
        {activeSection === 'faq' && (
          <div>
            <div className="relative mb-6">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
              <input type="search" aria-label="Search FAQs" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search FAQs..." className="w-full pl-11 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-amber-400 focus:bg-white outline-none transition" />
            </div>
            {faqs.length === 0 ? (
              <p className="text-stone-500 text-center py-8">No matching questions. Try the contact page.</p>
            ) : (
              <div className="space-y-3">
                {faqs.map((f, i) => (
                  <div key={f.q} className="border border-stone-200 rounded-2xl overflow-hidden">
                    <button onClick={() => setExpanded(expanded === i ? null : i)} aria-expanded={expanded === i} className="w-full flex items-center justify-between gap-4 p-4 text-left hover:bg-stone-50">
                      <span className="font-medium text-stone-900">{f.q}</span>
                      <ChevronDown size={20} className={`shrink-0 text-stone-400 transition-transform ${expanded === i ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded === i && <div className="px-4 pb-4 text-stone-600 leading-relaxed">{f.a}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSection === 'cancellation' && (
          <div className="space-y-4">
            <h2 className="font-serif text-2xl font-bold text-stone-900">Cancellation policy</h2>
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl"><h3 className="font-semibold text-emerald-800 mb-1">Free cancellation</h3><p className="text-emerald-900/80">Cancel up to {grace} hours before check-in at no charge.</p></div>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl"><h3 className="font-semibold text-amber-800 mb-1">Late cancellations</h3><p className="text-amber-900/80">Within {grace} hours of check-in, {penalty}% of the booking may be charged.</p></div>
            <p className="text-sm text-stone-500">Policies for {hotel} may vary by rate plan; the terms shown at booking apply.</p>
          </div>
        )}

        {activeSection === 'terms' && (
          <div className="space-y-6">
            <h2 className="font-serif text-2xl font-bold text-stone-900">Terms & policies</h2>
            {settings.bookingTerms ? <p className="text-stone-600 whitespace-pre-line leading-relaxed">{settings.bookingTerms}</p> : policies.length === 0 && <p className="text-stone-500">Please contact the hotel for our full terms and conditions.</p>}
            {policies.map(p => (
              <div key={p.id}>
                <h3 className="font-semibold text-stone-900 mb-1">{p.title}</h3>
                <p className="text-stone-600 whitespace-pre-line leading-relaxed">{p.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Reveal>
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 rounded-3xl bg-amber-50 border border-amber-100 p-6">
          <div><h3 className="font-semibold text-stone-900">Still need help?</h3><p className="text-sm text-stone-600">Our team is happy to assist.</p></div>
          <div className="flex flex-wrap gap-3">
            {settings.contactPhone && <a href={`tel:${settings.contactPhone}`} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-stone-900 text-white text-sm font-semibold"><Phone size={16} />{settings.contactPhone}</a>}
            {settings.contactEmail && <a href={`mailto:${settings.contactEmail}`} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white border border-stone-200 text-stone-800 text-sm font-semibold"><Mail size={16} />Email us</a>}
            <Link to="/public-portal?section=contact" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white border border-stone-200 text-stone-800 text-sm font-semibold">Contact form</Link>
          </div>
        </div>
      </Reveal>
    </div>
  );
};

export default SupportCenterModule;
