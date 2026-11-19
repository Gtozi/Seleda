/**
 * Contact Module
 * Real hotel contact details and a contact form that creates a Sales CRM lead.
 */

import { useState } from 'react';
import { MapPin, Phone, Mail, Send, Clock } from 'lucide-react';
import { InquiryStatus, ModuleHeader, SubmitButton, inputClass, useInquiry, usePublicSettings, HERO } from '../shared';

const label = 'block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1';
const empty = { name: '', email: '', subject: '', message: '' };

const ContactLiveChatModule: React.FC = () => {
  const settings = usePublicSettings();
  const [form, setForm] = useState(empty);
  const { submit, submitting, done, error } = useInquiry('/api/public/contact');
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const methods = [
    settings.contactPhone && { id: 'phone', icon: <Phone size={24} />, label: 'Phone', value: settings.contactPhone, href: `tel:${settings.contactPhone}` },
    settings.contactEmail && { id: 'email', icon: <Mail size={24} />, label: 'Email', value: settings.contactEmail, href: `mailto:${settings.contactEmail}` },
    settings.customHotelAddress && { id: 'address', icon: <MapPin size={24} />, label: 'Address', value: settings.customHotelAddress, href: '' },
    (settings.checkInTime || settings.checkOutTime) && { id: 'hours', icon: <Clock size={24} />, label: 'Check-in / Check-out', value: `${settings.checkInTime || '—'} / ${settings.checkOutTime || '—'}`, href: '' },
  ].filter(Boolean) as { id: string; icon: React.ReactNode; label: string; value: string; href: string }[];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await submit(form)) setForm(empty);
  };

  return (
    <div className="[&>*+*]:mt-8">
      <ModuleHeader image={HERO.contact} title="Contact Us" subtitle="We're here to help with your stay, events and special requests" gradient="from-teal-700 to-cyan-900" />

      {methods.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {methods.map(m => (
            <div key={m.id} className="bg-white dark:bg-stone-800 rounded-3xl p-6 shadow-sm border border-stone-200/70 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-center gap-3 mb-3 text-teal-600">
                {m.icon}
                <h3 className="text-lg font-bold text-stone-900 dark:text-white">{m.label}</h3>
              </div>
              {m.href ? (
                <a href={m.href} className="font-semibold text-stone-900 dark:text-white hover:text-teal-600 break-words">{m.value}</a>
              ) : (
                <p className="font-semibold text-stone-900 dark:text-white">{m.value}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-stone-200/70 max-w-3xl">
        <h2 className="font-serif text-2xl font-bold text-stone-900 mb-5">Send us a Message</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={label} htmlFor="c-name">Name</label><input id="c-name" required value={form.name} onChange={set('name')} className={inputClass} /></div>
            <div><label className={label} htmlFor="c-email">Email</label><input id="c-email" type="email" required value={form.email} onChange={set('email')} className={inputClass} /></div>
          </div>
          <div><label className={label} htmlFor="c-subject">Subject</label><input id="c-subject" required value={form.subject} onChange={set('subject')} className={inputClass} /></div>
          <div><label className={label} htmlFor="c-msg">Message</label><textarea id="c-msg" rows={4} required value={form.message} onChange={set('message')} className={inputClass} /></div>
          <InquiryStatus done={done} error={error} successText="Message sent. We'll get back to you soon." />
          <SubmitButton submitting={submitting} className="w-full bg-teal-600 hover:bg-teal-700 text-white py-3 rounded-full font-semibold transition-colors">
            <Send size={18} /> Send Message
          </SubmitButton>
        </form>
      </div>
    </div>
  );
};

export default ContactLiveChatModule;
