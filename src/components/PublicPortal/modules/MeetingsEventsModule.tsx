/**
 * Meetings & Events Module
 * Venues come from the Banquet & Events portal; inquiries land in the Sales CRM.
 */

import { useState } from 'react';
import { Building, Users, Calendar, Send } from 'lucide-react';
import { EmptyState, InquiryStatus, ModuleHeader, SubmitButton, inputClass, useInquiry, usePublicData, HERO } from '../shared';

interface Venue { id: string; name: string; type: string; capacity: number; features: string[] }

const eventTypes = [
  { id: 'Conference', icon: <Users size={24} /> },
  { id: 'Meeting', icon: <Building size={24} /> },
  { id: 'Seminar', icon: <Calendar size={24} /> },
  { id: 'Exhibition', icon: <Building size={24} /> },
  { id: 'Corporate Event', icon: <Users size={24} /> },
];

const label = 'block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1';
const empty = { eventType: '', attendees: '', startDate: '', endDate: '', requirements: '', contactName: '', contactEmail: '', contactPhone: '', company: '' };

const MeetingsEventsModule: React.FC = () => {
  const [form, setForm] = useState(empty);
  const [typeError, setTypeError] = useState(false);
  const { submit, submitting, done, error } = useInquiry('/api/public/meeting-inquiry');
  const { data: venues, loading } = usePublicData<Venue[]>('/api/public/venues', j => j.venues || [], []);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const today = new Date().toISOString().slice(0, 10);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.eventType) return setTypeError(true);
    const { endDate, company, requirements, ...rest } = form;
    if (await submit({ ...rest, ...(endDate && { endDate }), ...(company && { company }), ...(requirements && { requirements }) })) setForm(empty);
  };

  return (
    <div className="[&>*+*]:mt-8">
      <ModuleHeader image={HERO.meetings} title="Meetings & Events" subtitle="Plan your event with our versatile venues and professional team" gradient="from-blue-700 to-indigo-900" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-stone-200/70">
          <h2 className="font-serif text-2xl font-bold text-stone-900 mb-5">Event Type</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Event type">
            {eventTypes.map(type => (
              <button
                type="button"
                role="radio"
                aria-checked={form.eventType === type.id}
                key={type.id}
                onClick={() => { setForm(f => ({ ...f, eventType: type.id })); setTypeError(false); }}
                className={`p-4 rounded-lg border-2 transition-colors ${form.eventType === type.id ? 'border-amber-500 bg-amber-50' : 'border-stone-200 dark:border-stone-700 hover:border-amber-300'}`}
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="text-amber-600">{type.icon}</div>
                  <span className="font-medium text-stone-900 dark:text-white text-sm">{type.id}</span>
                </div>
              </button>
            ))}
          </div>
          {typeError && <p role="alert" className="text-sm text-rose-600 mt-3">Please choose an event type.</p>}
        </div>

        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-stone-200/70">
          <h2 className="font-serif text-2xl font-bold text-stone-900 mb-5">Our Venues</h2>
          {loading ? (
            <div className="h-24 animate-pulse bg-stone-100 dark:bg-stone-700 rounded-lg" />
          ) : venues.length === 0 ? (
            <EmptyState title="Venue details are available on request." />
          ) : (
            <div className="space-y-4">
              {venues.map(v => (
                <div key={v.id} className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2 gap-3">
                    <h3 className="font-semibold text-stone-900 dark:text-white">{v.name}</h3>
                    {v.capacity > 0 && <span className="text-sm text-stone-600 dark:text-stone-400 shrink-0">Up to {v.capacity} guests</span>}
                  </div>
                  {v.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {v.features.map((f, i) => <span key={i} className="text-xs bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 px-2 py-1 rounded">{f}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-stone-200/70">
        <h2 className="font-serif text-2xl font-bold text-stone-900 mb-5">Submit Inquiry</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={label} htmlFor="m-name">Contact name</label><input id="m-name" required value={form.contactName} onChange={set('contactName')} className={inputClass} /></div>
            <div><label className={label} htmlFor="m-company">Company</label><input id="m-company" value={form.company} onChange={set('company')} className={inputClass} /></div>
            <div><label className={label} htmlFor="m-email">Email</label><input id="m-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')} className={inputClass} /></div>
            <div><label className={label} htmlFor="m-phone">Phone</label><input id="m-phone" type="tel" required value={form.contactPhone} onChange={set('contactPhone')} className={inputClass} /></div>
            <div><label className={label} htmlFor="m-att">Number of attendees</label><input id="m-att" type="number" min={1} required value={form.attendees} onChange={set('attendees')} className={inputClass} /></div>
            <div><label className={label} htmlFor="m-date">Preferred date</label><input id="m-date" type="date" min={today} required value={form.startDate} onChange={set('startDate')} className={inputClass} /></div>
          </div>
          <div><label className={label} htmlFor="m-req">Special requirements</label><textarea id="m-req" rows={4} value={form.requirements} onChange={set('requirements')} placeholder="Tell us about your event requirements..." className={inputClass} /></div>
          <InquiryStatus done={done} error={error} successText="Thank you! Our events team will contact you shortly." />
          <SubmitButton submitting={submitting} className="w-full bg-stone-900 hover:bg-stone-800 text-white py-3 rounded-full font-semibold transition-colors">
            <Send size={18} /> Submit Inquiry
          </SubmitButton>
        </form>
      </div>
    </div>
  );
};

export default MeetingsEventsModule;
