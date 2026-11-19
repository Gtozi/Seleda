/**
 * Experiences & Activities Module
 * Bookable activity-style guest services configured by the hotel.
 */

import { Link } from 'react-router-dom';
import { Compass, ArrowRight } from 'lucide-react';
import { EmptyState, ErrorState, LoadingGrid, ModuleHeader, Reveal, SectionHead, formatMoney, usePublicData, HERO } from '../shared';

interface Experience {
  id: string;
  name: string;
  duration: string;
  price: number;
  type: string;
  description: string;
}

const ExperiencesActivitiesModule: React.FC = () => {
  const { data: experiences, loading, error, retry } = usePublicData<Experience[]>('/api/public/experiences', j => j.experiences || [], []);

  return (
    <div>
      <ModuleHeader image={HERO.experiences} title="Experiences & Activities" subtitle="Discover local experiences and adventures — add them when you book your stay" gradient="from-emerald-700 to-teal-900" eyebrow="Beyond the stay" />

      <SectionHead eyebrow="Experiences" title="Things to do" />
      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <LoadingGrid count={4} />
      ) : experiences.length === 0 && !error ? (
        <EmptyState title="No experiences are listed right now." hint="Ask our concierge about tours and activities during your stay." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {experiences.map((exp, i) => (
            <Reveal key={exp.id} delay={Math.min(i, 6) * 0.06}>
              <div className="group bg-white rounded-3xl border border-stone-200/70 p-7 h-full flex flex-col hover:shadow-xl hover:-translate-y-1 hover:border-emerald-200 transition-all duration-300">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Compass size={22} /></div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600 mb-1">{exp.type}</p>
                <h3 className="font-serif text-2xl font-bold text-stone-900">{exp.name}</h3>
                {exp.description && <p className="text-sm text-stone-600 mt-2 leading-relaxed">{exp.description}</p>}
                <div className="mt-auto pt-6 flex items-center justify-between">
                  <span className="font-serif text-2xl font-bold text-emerald-700">{formatMoney(exp.price)}</span>
                  <Link to="/public-portal?section=booking" className="inline-flex items-center gap-1.5 bg-stone-900 hover:bg-stone-800 text-white px-5 py-2.5 rounded-full font-semibold text-sm transition-colors">Add to stay <ArrowRight size={14} /></Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExperiencesActivitiesModule;
