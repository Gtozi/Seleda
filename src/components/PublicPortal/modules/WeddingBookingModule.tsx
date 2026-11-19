/**
 * Wedding Booking Module
 * Wedding inquiry form — submissions land in the Sales CRM as website leads.
 */

import { useState } from 'react';
import { Send } from 'lucide-react';
import { InquiryStatus, ModuleHeader, SubmitButton, inputClass, useInquiry, usePublicSettings, HERO } from '../shared';

const label = 'block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1';
const empty = { contactName: '', contactEmail: '', contactPhone: '', weddingDate: '', guestCount: '', message: '' };

const WeddingBookingModule: React.FC = () => {
  const settings = usePublicSettings();
  const [form, setForm] = useState(empty);
  const { submit, submitting, done, error } = useInquiry('/api/public/wedding-inquiry');
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const today = new Date().toISOString().slice(0, 10);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await submit(form)) setForm(empty);
  };

  return (
    <div className="[&>*+*]:mt-8">
      <ModuleHeader image={HERO.weddings} title="Wedding Planning" subtitle="Tell us about your day — our events team will prepare a personalised proposal" gradient="from-pink-700 to-rose-900" />

      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-stone-200/70 max-w-3xl">
        <h2 className="font-serif text-2xl font-bold text-stone-900 mb-5">Wedding Inquiry</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={label} htmlFor="w-name">Your name</label><input id="w-name" required value={form.contactName} onChange={set('contactName')} className={inputClass} /></div>
            <div><label className={label} htmlFor="w-email">Email</label><input id="w-email" type="email" required value={form.contactEmail} onChange={set('contactEmail')} className={inputClass} /></div>
            <div><label className={label} htmlFor="w-phone">Phone</label><input id="w-phone" type="tel" required value={form.contactPhone} onChange={set('contactPhone')} className={inputClass} /></div>
            <div><label className={label} htmlFor="w-date">Wedding date</label><input id="w-date" type="date" min={today} required value={form.weddingDate} onChange={set('weddingDate')} className={inputClass} /></div>
            <div><label className={label} htmlFor="w-guests">Expected guests</label><input id="w-guests" type="number" min={1} required value={form.guestCount} onChange={set('guestCount')} className={inputClass} /></div>
          </div>
          <div><label className={label} htmlFor="w-msg">Tell us about your plans (optional)</label><textarea id="w-msg" rows={4} value={form.message} onChange={set('message')} className={inputClass} /></div>
          <InquiryStatus done={done} error={error} successText="Thank you! Our events team will contact you shortly." />
          <SubmitButton submitting={submitting} className="w-full bg-pink-600 hover:bg-pink-700 text-white py-3 rounded-full font-semibold transition-colors">
            <Send size={18} /> Submit Inquiry
          </SubmitButton>
          {settings.contactPhone && <p className="text-xs text-stone-500 text-center">Prefer to talk? Call {settings.contactPhone}</p>}
        </form>
      </div>
    </div>
  );
};

export default WeddingBookingModule;
