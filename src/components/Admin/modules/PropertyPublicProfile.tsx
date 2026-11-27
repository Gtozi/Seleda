/**
 * PropertyPublicProfile — Public-facing property profile editor (Admin portal).
 *
 * Live DB-integrated: reads and writes to properties table (metadata, address, contact fields).
 * Uses the shared UI system from Front Office for consistency with F&B, HK, and Engineering.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Save, ExternalLink, Image as ImageIcon, Building2, Loader2, CheckCircle2, AlertTriangle, Phone, Mail, MapPin, Star, RefreshCw } from 'lucide-react';
import StatCard from '../../FrontOffice/StatCard';
import { PageHeader, SectionCard, Badge } from '../../FrontOffice/ui';
import { card, button } from '../../FrontOffice/brandTheme';
import { adminAuthHeaders } from '../shared/ResourceManager';

interface PropertyRow {
  id: string;
  property_name: string;
  property_code: string;
  property_type: string | null;
  star_rating: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: { street?: string; city?: string; country?: string } | null;
  metadata: { description?: string; imageUrl?: string; amenities?: string[]; facilities?: string[]; website?: string } | null;
}

interface Draft {
  description: string;
  imageUrl: string;
  amenities: string;
  facilities: string;
  website: string;
  contact_phone: string;
  contact_email: string;
  star_rating: string;
  street: string;
  city: string;
  country: string;
}

const toDraft = (p: PropertyRow): Draft => ({
  description: p.metadata?.description || '',
  imageUrl: p.metadata?.imageUrl || '',
  amenities: (p.metadata?.amenities || []).join(', '),
  facilities: (p.metadata?.facilities || []).join(', '),
  website: p.metadata?.website || '',
  contact_phone: p.contact_phone || '',
  contact_email: p.contact_email || '',
  star_rating: p.star_rating ? String(p.star_rating) : '',
  street: p.address?.street || '',
  city: p.address?.city || '',
  country: p.address?.country || '',
});

const splitList = (v: string) => Array.from(new Set(v.split(',').map(s => s.trim()).filter(Boolean)));
const authHeaders = adminAuthHeaders;

const inputCls = 'w-full bg-slate-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-accent-operations)]';
const labelCls = 'text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1.5';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><label className={labelCls}>{label}</label>{children}</div>
);

const PropertyPublicProfile: React.FC = () => {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/properties', { headers: authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load properties');
      const list: PropertyRow[] = json.properties || [];
      setProperties(list);
      setSelectedId(prev => prev || list[0]?.id || '');
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to load properties' });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => properties.find(p => p.id === selectedId) || null, [properties, selectedId]);
  useEffect(() => { setDraft(selected ? toDraft(selected) : null); setMessage(null); }, [selected]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(d => (d ? { ...d, [k]: e.target.value } : d));
  const dirty = !!(selected && draft && JSON.stringify(toDraft(selected)) !== JSON.stringify(draft));
  const imageOk = !draft?.imageUrl || /^https?:\/\//i.test(draft.imageUrl);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !draft) return;
    if (!imageOk) return setMessage({ type: 'error', text: 'Photo URL must start with http:// or https://' });
    setSaving(true);
    setMessage(null);
    try {
      const star = Number(draft.star_rating);
      const res = await fetch(`/api/admin/properties/${selected.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          contact_phone: draft.contact_phone.trim() || null,
          contact_email: draft.contact_email.trim() || null,
          ...(star >= 1 && star <= 5 ? { star_rating: star } : {}),
          address: { street: draft.street.trim(), city: draft.city.trim(), country: draft.country.trim() },
          metadata: {
            description: draft.description.trim(),
            imageUrl: draft.imageUrl.trim(),
            amenities: splitList(draft.amenities),
            facilities: splitList(draft.facilities),
            website: draft.website.trim(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setProperties(list => list.map(p => (p.id === selected.id ? { ...p, ...json.property } : p)));
      setMessage({ type: 'ok', text: 'Saved — the public website updates within seconds.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const withPreview = selected && (selected.metadata?.description || selected.metadata?.imageUrl || selected.metadata?.amenities?.length);
  const amenitiesList = selected?.metadata?.amenities || [];
  const facilitiesList = selected?.metadata?.facilities || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Property Public Profile"
        subtitle="Manage public website photo, description, amenities, and contacts."
        icon={Globe}
        actions={
          <>
            <button onClick={load} className={button.secondary}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <a href="/public-portal?section=properties" target="_blank" rel="noreferrer" className={button.secondary}>
              <Globe size={16} /> View on website <ExternalLink size={12} />
            </a>
          </>
        }
      />

      {message && (
        <div className={`p-4 border rounded-2xl ${message.type === 'ok' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20' : 'bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20'}`}>
          <p className={`text-sm font-medium ${message.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {message.type === 'ok' ? <CheckCircle2 size={16} className="inline mr-1.5" /> : <AlertTriangle size={16} className="inline mr-1.5" />}
            {message.text}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading properties…</div>
      ) : properties.length === 0 ? (
        <SectionCard pad="md">
          <div className="text-center text-gray-500 text-sm">No active properties. Add one under Tenant & Property first.</div>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
          <SectionCard title="Properties" subtitle={properties.length} icon={Building2} tone="accent" pad="sm">
            <div className="space-y-1">
              {properties.map(p => (
                <button key={p.id} onClick={() => setSelectedId(p.id)} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition ${p.id === selectedId ? 'bg-[var(--color-accent-operations)]/10 text-[var(--color-accent-operations)]' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-gray-700 dark:text-gray-300'}`}>
                  <Building2 size={18} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold truncate">{p.property_name}</span>
                    <span className="block text-xs text-gray-400 capitalize">{p.property_type || 'hotel'}{p.metadata?.description ? '' : ' · no description'}</span>
                  </span>
                </button>
              ))}
            </div>
          </SectionCard>

          {draft && selected && (
            <div className="space-y-6">
              {/* Live preview card */}
              {withPreview && (
                <SectionCard title="Public Preview" subtitle="How this property appears to guests" icon={Globe} tone="info" pad="lg">
                  <div className="flex flex-col md:flex-row gap-6">
                    <div className="w-full md:w-64 shrink-0">
                      <div className="aspect-[4/3] rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        {selected.metadata?.imageUrl ? (
                          <img src={selected.metadata.imageUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300"><ImageIcon size={32} /></div>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{selected.property_name}</h3>
                        {selected.star_rating && (
                          <div className="flex items-center gap-0.5 mt-1 text-amber-400">
                            {[...Array(selected.star_rating)].map((_, i) => <Star key={i} size={14} fill="currentColor" />)}
                          </div>
                        )}
                      </div>
                      {selected.metadata?.description && <p className="text-sm text-gray-600 dark:text-gray-400">{selected.metadata.description}</p>}
                      {(selected.address?.street || selected.address?.city || selected.address?.country) && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <MapPin size={14} />
                          <span>{[selected.address.street, selected.address.city, selected.address.country].filter(Boolean).join(', ')}</span>
                        </div>
                      )}
                      {selected.contact_phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Phone size={14} />
                          <span>{selected.contact_phone}</span>
                        </div>
                      )}
                      {selected.contact_email && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Mail size={14} />
                          <span>{selected.contact_email}</span>
                        </div>
                      )}
                      {amenitiesList.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Amenities</p>
                          <div className="flex flex-wrap gap-2">
                            {amenitiesList.slice(0, 6).map((a, i) => (
                              <Badge key={i} tone="neutral">{a}</Badge>
                            ))}
                            {amenitiesList.length > 6 && <Badge tone="neutral">+{amenitiesList.length - 6} more</Badge>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Edit form */}
              <SectionCard title="Edit Profile" subtitle="Update public-facing information" icon={Save} tone="accent" pad="lg">
                <form onSubmit={save} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
                    <div>
                      <Field label="Photo preview">
                        <div className="aspect-[4/3] rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                          {draft.imageUrl && imageOk ? (
                            <img src={draft.imageUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                          ) : (
                            <ImageIcon size={32} className="text-slate-300" />
                          )}
                        </div>
                      </Field>
                    </div>
                    <div className="space-y-4">
                      <Field label="Photo URL">
                        <input value={draft.imageUrl} onChange={set('imageUrl')} placeholder="https://…/photo.jpg" className={inputCls} />
                        {!imageOk && <span className="text-xs text-rose-600 mt-1 block">Must start with http:// or https://</span>}
                      </Field>
                      <Field label="Description">
                        <textarea rows={4} value={draft.description} onChange={set('description')} placeholder="A short, welcoming description shown on the website" className={inputCls} />
                      </Field>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Amenities (comma separated)">
                      <input value={draft.amenities} onChange={set('amenities')} placeholder="Free WiFi, Pool, Spa, Restaurant" className={inputCls} />
                    </Field>
                    <Field label="Facilities (comma separated)">
                      <input value={draft.facilities} onChange={set('facilities')} placeholder="Conference rooms, Parking, Airport shuttle" className={inputCls} />
                    </Field>
                    <Field label="Street">
                      <input value={draft.street} onChange={set('street')} className={inputCls} />
                    </Field>
                    <Field label="City">
                      <input value={draft.city} onChange={set('city')} className={inputCls} />
                    </Field>
                    <Field label="Country">
                      <input value={draft.country} onChange={set('country')} className={inputCls} />
                    </Field>
                    <Field label="Star rating (1–5)">
                      <input type="number" min={1} max={5} value={draft.star_rating} onChange={set('star_rating')} className={inputCls} />
                    </Field>
                    <Field label="Public phone">
                      <input value={draft.contact_phone} onChange={set('contact_phone')} className={inputCls} />
                    </Field>
                    <Field label="Public email">
                      <input type="email" value={draft.contact_email} onChange={set('contact_email')} className={inputCls} />
                    </Field>
                    <Field label="Website" className="md:col-span-2">
                      <input value={draft.website} onChange={set('website')} placeholder="https://" className={inputCls} />
                    </Field>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                    <div className="text-sm min-h-[1.25rem]" role="status">
                      {message?.type === 'ok' && <span className="inline-flex items-center gap-1.5 text-emerald-600"><CheckCircle2 size={16} />{message.text}</span>}
                      {message?.type === 'error' && <span className="inline-flex items-center gap-1.5 text-rose-600"><AlertTriangle size={16} />{message.text}</span>}
                    </div>
                    <button type="submit" disabled={!dirty || saving} className={button.primary}>
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
                    </button>
                  </div>
                </form>
              </SectionCard>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PropertyPublicProfile;
