/**
 * Special Offers Module
 * Live promotions from Revenue Management (active and within their date window).
 */

import { Link } from 'react-router-dom';
import { Tag, Clock, Percent, Flame, Gift, ArrowRight } from 'lucide-react';
import { EmptyState, ErrorState, LoadingGrid, ModuleHeader, Reveal, SectionHead, usePublicData, HERO } from '../shared';

interface Offer {
  id: string;
  title: string;
  discount: string;
  description: string;
  validUntil: string;
  type: string;
  code?: string;
}

const iconFor = (type: string) => {
  switch (type) {
    case 'flash': return <Flame size={16} />;
    case 'early': return <Clock size={16} />;
    case 'discount': return <Percent size={16} />;
    case 'loyalty': return <Gift size={16} />;
    default: return <Tag size={16} />;
  }
};

const SpecialOffersModule: React.FC = () => {
  const { data: offers, loading, error, retry } = usePublicData<Offer[]>('/api/public/special-offers', j => j.offers || [], []);

  return (
    <div>
      <ModuleHeader image={HERO.offers} title="Special Offers" subtitle="Exclusive deals for guests who book direct" gradient="from-red-700 to-rose-900" eyebrow="Book direct & save" />

      <SectionHead eyebrow="Offers" title="Current promotions" />
      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <LoadingGrid count={3} />
      ) : offers.length === 0 && !error ? (
        <EmptyState title="No special offers right now." hint="Check back soon — new promotions are added regularly." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {offers.map((o, i) => (
            <Reveal key={o.id} delay={Math.min(i, 6) * 0.06}>
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-stone-900 via-stone-800 to-amber-900 text-white p-7 flex flex-col h-full min-h-[260px] hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
                <div aria-hidden className="absolute -right-10 -top-10 w-44 h-44 rounded-full bg-amber-400/20 blur-2xl" />
                <span className="relative self-start bg-amber-400 text-stone-900 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1.5">{iconFor(o.type)} {o.discount}</span>
                <h3 className="relative font-serif text-2xl font-bold mt-5">{o.title}</h3>
                {o.description && <p className="relative text-sm text-white/75 mt-2">{o.description}</p>}
                {o.code && <p className="relative text-sm mt-3">Code <span className="font-mono font-semibold bg-white/15 px-2 py-0.5 rounded">{o.code}</span></p>}
                {o.validUntil && <p className="relative text-xs text-white/50 mt-3">Valid until {o.validUntil}</p>}
                <Link to="/public-portal?section=booking" className="relative mt-auto pt-5 inline-flex items-center gap-2 font-semibold text-amber-300 hover:text-amber-200">Book now <ArrowRight size={16} /></Link>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpecialOffersModule;
