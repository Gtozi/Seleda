/**
 * Packages & Promotions Module
 * Packages configured in the ERP, bookable as add-ons in the booking flow.
 */

import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { EmptyState, ErrorState, LoadingGrid, ModuleHeader, Reveal, SectionHead, formatMoney, usePublicData, HERO } from '../shared';

interface Pkg { id: string; name: string; description: string; price: number; chargeFrequency: 'once' | 'daily' }

const PackagesPromotionsModule: React.FC = () => {
  const { data: packages, loading, error, retry } = usePublicData<Pkg[]>('/api/public/packages', j => j.packages || [], []);

  return (
    <div>
      <ModuleHeader image={HERO.packages} title="Stay Packages" subtitle="Enhance your stay — add a package when you book" gradient="from-purple-700 to-indigo-900" eyebrow="Add-ons" />

      <SectionHead eyebrow="Packages" title="Make it your own" />
      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <LoadingGrid />
      ) : packages.length === 0 && !error ? (
        <EmptyState title="No packages are available right now." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {packages.map((p, i) => (
            <Reveal key={p.id} delay={Math.min(i, 6) * 0.06}>
              <div className="group bg-white rounded-3xl border border-stone-200/70 p-7 h-full flex flex-col hover:shadow-xl hover:-translate-y-1 hover:border-purple-200 transition-all duration-300">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Sparkles size={22} /></div>
                <h3 className="font-serif text-2xl font-bold text-stone-900">{p.name}</h3>
                {p.description && <p className="text-stone-600 text-sm mt-2 leading-relaxed">{p.description}</p>}
                <div className="mt-auto pt-6 flex items-end justify-between">
                  <div>
                    <span className="font-serif text-3xl font-bold text-purple-700">{formatMoney(p.price)}</span>
                    <span className="text-sm text-stone-500"> {p.chargeFrequency === 'daily' ? '/ night' : 'per stay'}</span>
                  </div>
                  <Link to="/public-portal?section=booking" className="inline-flex items-center gap-1.5 bg-stone-900 hover:bg-stone-800 text-white px-5 py-2.5 rounded-full font-semibold text-sm transition-colors">Book <ArrowRight size={14} /></Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
};

export default PackagesPromotionsModule;
