/**
 * Reviews & Testimonials Module
 * Approved guest testimonials (public_testimonials, moderated in Sales → Reputation).
 */

import { Star, Quote } from 'lucide-react';
import { EmptyState, ErrorState, LoadingGrid, ModuleHeader, Reveal, SectionHead, usePublicData, HERO } from '../shared';

interface Review {
  id: string;
  name: string;
  location: string;
  rating: number;
  date: string;
  roomType: string;
  comment: string;
}

const ReviewsTestimonialsModule: React.FC = () => {
  const { data: reviews, loading, error, retry } = usePublicData<Review[]>('/api/public/reviews', j => j.reviews || [], []);
  const average = reviews.length ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;

  return (
    <div>
      <ModuleHeader image={HERO.reviews} title="Guest Reviews" subtitle="See what our guests have to say about their stay" gradient="from-amber-600 to-orange-800" eyebrow="Guest stories">
        {reviews.length > 0 && (
          <div className="inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20">
            <span className="font-serif text-3xl font-bold text-amber-300">{average.toFixed(1)}</span>
            <div>
              <div className="flex">{[1, 2, 3, 4, 5].map(i => <Star key={i} size={14} className={i <= Math.round(average) ? 'text-amber-300 fill-amber-300' : 'text-white/30'} />)}</div>
              <p className="text-xs text-white/70">{reviews.length} guest review{reviews.length > 1 ? 's' : ''}</p>
            </div>
          </div>
        )}
      </ModuleHeader>

      <SectionHead eyebrow="Testimonials" title="In their own words" />
      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <LoadingGrid />
      ) : reviews.length === 0 && !error ? (
        <EmptyState title="No reviews published yet." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviews.map((r, i) => (
            <Reveal key={r.id} delay={Math.min(i, 6) * 0.06}>
              <figure className="relative bg-white rounded-3xl p-7 border border-stone-200/70 h-full flex flex-col hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <Quote aria-hidden size={36} className="absolute top-5 right-5 text-amber-100" />
                <div className="flex mb-4" aria-label={`${r.rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={16} className={n <= r.rating ? 'text-amber-500 fill-amber-500' : 'text-stone-300'} />)}</div>
                <blockquote className="text-stone-700 leading-relaxed mb-5">{r.comment}</blockquote>
                <figcaption className="mt-auto text-sm">
                  <span className="font-semibold text-stone-900">{r.name}</span>
                  {r.location && <span className="text-stone-500"> · {r.location}</span>}
                  <span className="block text-xs text-stone-400 mt-0.5">{[r.roomType, String(r.date).slice(0, 10)].filter(Boolean).join(' · ')}</span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReviewsTestimonialsModule;
