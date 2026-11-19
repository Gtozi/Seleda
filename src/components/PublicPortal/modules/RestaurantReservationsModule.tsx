/**
 * Restaurant Reservations Module
 * Dining outlets come from the F&B outlets managed in the ERP.
 */

import { UtensilsCrossed, Clock, Phone, Mail } from 'lucide-react';
import { EmptyState, ErrorState, LoadingGrid, ModuleHeader, Reveal, SectionHead, usePublicData, usePublicSettings, HERO } from '../shared';

interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  description: string;
  openingHours: string;
}

const RestaurantReservationsModule: React.FC = () => {
  const settings = usePublicSettings();
  const { data: restaurants, loading, error, retry } = usePublicData<Restaurant[]>('/api/public/restaurants', j => j.restaurants || [], []);

  return (
    <div>
      <ModuleHeader image={HERO.dining} title="Dining" subtitle="Reserve your table at our restaurants and lounges" gradient="from-rose-700 to-orange-900" eyebrow="Taste the place">
        {settings.contactPhone && (
          <a href={`tel:${settings.contactPhone}`} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-amber-400 hover:bg-amber-300 text-stone-900 font-semibold transition-colors"><Phone size={16} /> Reserve a table</a>
        )}
      </ModuleHeader>

      <SectionHead eyebrow="Restaurants & bars" title="Where to dine" />
      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <LoadingGrid />
      ) : restaurants.length === 0 && !error ? (
        <EmptyState title="Our dining outlets will be listed here soon." hint="Contact the hotel to reserve a table." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {restaurants.map((r, i) => (
            <Reveal key={r.id} delay={Math.min(i, 6) * 0.06}>
              <div className="group bg-white rounded-3xl border border-stone-200/70 p-7 h-full flex flex-col hover:shadow-xl hover:-translate-y-1 hover:border-rose-200 transition-all duration-300">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><UtensilsCrossed size={22} /></div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-600 mb-1">{r.cuisine}</p>
                <h3 className="font-serif text-2xl font-bold text-stone-900">{r.name}</h3>
                {r.description && <p className="text-stone-600 mt-2 leading-relaxed">{r.description}</p>}
                {r.openingHours && <div className="flex items-center gap-2 text-sm text-stone-600 mt-4"><Clock size={16} className="text-stone-400" /> Today: {r.openingHours}</div>}
                <div className="mt-auto pt-6 flex gap-2">
                  {settings.contactPhone && <a href={`tel:${settings.contactPhone}`} className="flex-1 flex items-center justify-center gap-2 bg-stone-900 hover:bg-stone-800 text-white py-2.5 rounded-full font-semibold text-sm transition-colors"><Phone size={15} /> Call to reserve</a>}
                  {settings.contactEmail && <a href={`mailto:${settings.contactEmail}?subject=${encodeURIComponent(`Table reservation — ${r.name}`)}`} aria-label={`Email to reserve ${r.name}`} className="flex items-center justify-center px-4 py-2.5 rounded-full border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors"><Mail size={15} /></a>}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
};

export default RestaurantReservationsModule;
