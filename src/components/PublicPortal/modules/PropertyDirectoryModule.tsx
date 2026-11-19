/**
 * Property Directory Module
 * Properties configured in the ERP (Admin → Property Public Profile).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building, MapPin, Star, Phone, Mail, Bed, Search, Check, X, ArrowRight } from 'lucide-react';
import { EmptyState, ErrorState, LoadingGrid, ModuleHeader, Reveal, SectionHead, formatMoney, usePublicData, HERO } from '../shared';

interface Property {
  id: string;
  name: string;
  type: string;
  location: string;
  country: string;
  rating: number | null;
  reviewCount: number;
  starRating: number | null;
  description: string;
  imageUrl: string;
  amenities: string[];
  facilities: string[];
  contact: { phone: string; email: string; website: string };
  roomCount: number;
  startingPrice: number;
}

const PropertyDirectoryModule: React.FC = () => {
  const { data: properties, loading, error, retry } = usePublicData<Property[]>('/api/public/properties', j => j.properties || [], []);
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<Property | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const q = searchTerm.trim().toLowerCase();
  const filtered = properties.filter(p => !q || p.name.toLowerCase().includes(q) || p.location.toLowerCase().includes(q));

  return (
    <div>
      <ModuleHeader image={properties.find(p => p.imageUrl)?.imageUrl || HERO.properties} title="Our Properties" subtitle="Discover our hotels and where to find us" gradient="from-indigo-700 to-purple-900" eyebrow="Where to stay" />

      <SectionHead
        eyebrow="Stay"
        title="Choose your property"
        action={properties.length > 1 ? (
          <div className="relative hidden sm:block w-72">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
            <input type="search" aria-label="Search properties" placeholder="Search by name or location" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-11 pr-4 py-2.5 bg-white border border-stone-200 rounded-full text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition" />
          </div>
        ) : undefined}
      />

      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <LoadingGrid />
      ) : filtered.length === 0 && !error ? (
        <EmptyState title="No properties found." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((p, i) => (
            <Reveal key={p.id} delay={Math.min(i, 6) * 0.06}>
              <button onClick={() => setSelected(p)} className="group relative block w-full h-[420px] rounded-3xl overflow-hidden bg-stone-800 shadow-lg text-left focus-visible:ring-4 ring-amber-300 outline-none">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" /> : <Building size={56} className="absolute inset-0 m-auto text-stone-600" />}
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/30 to-transparent" />
                {p.rating != null && (
                  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full flex items-center gap-1"><Star size={14} className="text-amber-500 fill-amber-500" /><span className="text-sm font-semibold text-stone-900">{p.rating}</span></div>
                )}
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <h3 className="font-serif text-2xl font-bold">{p.name}</h3>
                  {p.starRating ? <div className="text-amber-300 text-sm mt-0.5" aria-label={`${p.starRating} star`}>{'★'.repeat(p.starRating)}</div> : null}
                  {p.location && <div className="flex items-center gap-1.5 text-white/75 text-sm mt-1"><MapPin size={14} /><span>{p.location}</span></div>}
                  {p.description && <p className="text-white/70 text-sm mt-3 line-clamp-2">{p.description}</p>}
                  <div className="flex items-center justify-between mt-5">
                    {p.startingPrice > 0 ? <div><span className="text-xs text-white/60">From </span><span className="text-2xl font-bold text-amber-300">{formatMoney(p.startingPrice)}</span><span className="text-white/60 text-sm"> / night</span></div> : <span />}
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/90">Details <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" /></span>
                  </div>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div role="dialog" aria-modal="true" aria-label={selected.name} onClick={e => e.stopPropagation()} className="bg-white rounded-[2rem] max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {selected.imageUrl && <div className="relative h-64"><img src={selected.imageUrl} alt={selected.name} className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" /></div>}
            <div className="p-6 md:p-8">
              <div className="flex justify-between items-start gap-4 mb-4">
                <div>
                  <h2 className="font-serif text-3xl font-bold text-stone-900 mb-1">{selected.name}</h2>
                  {selected.location && <div className="flex items-center gap-2 text-stone-600"><MapPin size={18} /><span>{selected.location}</span></div>}
                </div>
                <button onClick={() => setSelected(null)} aria-label="Close" className="p-2 rounded-full hover:bg-stone-100"><X size={20} /></button>
              </div>
              {selected.description && <p className="text-stone-600 leading-relaxed mb-6">{selected.description}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {selected.roomCount > 0 && <div className="bg-stone-50 p-4 rounded-2xl"><Bed size={22} className="text-amber-600 mb-2" /><div className="text-sm text-stone-500">Rooms</div><div className="font-semibold text-stone-900">{selected.roomCount}</div></div>}
                {selected.contact.phone && <a href={`tel:${selected.contact.phone}`} className="bg-stone-50 p-4 rounded-2xl hover:bg-amber-50 transition-colors"><Phone size={22} className="text-amber-600 mb-2" /><div className="text-sm text-stone-500">Phone</div><div className="font-semibold text-stone-900 text-sm">{selected.contact.phone}</div></a>}
                {selected.contact.email && <a href={`mailto:${selected.contact.email}`} className="bg-stone-50 p-4 rounded-2xl hover:bg-amber-50 transition-colors"><Mail size={22} className="text-amber-600 mb-2" /><div className="text-sm text-stone-500">Email</div><div className="font-semibold text-stone-900 text-sm break-all">{selected.contact.email}</div></a>}
              </div>
              {[['Amenities', selected.amenities], ['Facilities', selected.facilities]].map(([title, items]) => (items as string[]).length > 0 && (
                <div key={title as string} className="mb-6">
                  <h3 className="font-serif text-xl font-bold text-stone-900 mb-3">{title as string}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {(items as string[]).map(a => <div key={a} className="flex items-center gap-2 text-stone-700 text-sm"><Check size={16} className="text-emerald-500" />{a}</div>)}
                  </div>
                </div>
              ))}
              <div className="flex gap-3">
                <Link to="/public-portal?section=booking" className="flex-1 text-center bg-stone-900 hover:bg-stone-800 text-white py-3 rounded-full font-semibold transition-colors">Book now</Link>
                <button onClick={() => setSelected(null)} className="px-6 py-3 border border-stone-300 rounded-full hover:bg-stone-50 text-stone-700 font-medium">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PropertyDirectoryModule;
