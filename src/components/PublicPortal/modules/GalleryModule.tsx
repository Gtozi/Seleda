/**
 * Gallery Module
 * Photos come from the room-type and property setup in the ERP.
 */

import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState, ErrorState, ModuleHeader, Reveal, usePublicData, HERO } from '../shared';

interface Photo { url: string; caption: string; category: string }

const GalleryModule: React.FC = () => {
  const { data: photos, loading, error, retry } = usePublicData<Photo[]>('/api/public/gallery', j => j.images || [], []);
  const [filter, setFilter] = useState('All');
  const [open, setOpen] = useState<number | null>(null);

  const categories = ['All', ...Array.from(new Set(photos.map(p => p.category)))];
  const shown = filter === 'All' ? photos : photos.filter(p => p.category === filter);

  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen(i => (i == null ? i : (i + 1) % shown.length));
      if (e.key === 'ArrowLeft') setOpen(i => (i == null ? i : (i - 1 + shown.length) % shown.length));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, shown.length]);

  return (
    <div className="[&>*+*]:mt-8">
      <ModuleHeader image={photos[0]?.url || HERO.gallery} title="Photo Gallery" subtitle="A look at our rooms and properties" gradient="from-violet-700 to-purple-900" />

      {categories.length > 2 && (
        <div className="flex flex-wrap gap-2">
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${filter === c ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-400'}`}>{c}</button>
          ))}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={retry} />}
      {loading ? (
        <div className="columns-2 md:columns-3 gap-4 space-y-4" aria-busy="true">
          {[40, 56, 48, 64, 44, 52].map((h, i) => <div key={i} className="rounded-2xl bg-stone-200 animate-pulse" style={{ height: h * 4 }} />)}
        </div>
      ) : shown.length === 0 && !error ? (
        <EmptyState title="Photos will appear here soon." />
      ) : (
        <div className="columns-2 md:columns-3 gap-4 [&>*]:mb-4">
          {shown.map((p, i) => (
            <Reveal key={`${p.url}-${i}`} delay={Math.min(i, 8) * 0.04}>
              <button onClick={() => setOpen(i)} className="group relative block w-full overflow-hidden rounded-2xl focus-visible:ring-4 ring-amber-300 outline-none">
                <img src={p.url} alt={p.caption} loading="lazy" className="w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity text-left">{p.caption}</span>
              </button>
            </Reveal>
          ))}
        </div>
      )}

      {open != null && shown[open] && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4" onClick={() => setOpen(null)} role="dialog" aria-modal="true" aria-label="Photo viewer">
          <button aria-label="Close" onClick={() => setOpen(null)} className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"><X size={22} /></button>
          {shown.length > 1 && <button aria-label="Previous" onClick={e => { e.stopPropagation(); setOpen((open - 1 + shown.length) % shown.length); }} className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronLeft size={24} /></button>}
          <figure onClick={e => e.stopPropagation()} className="max-w-5xl max-h-full">
            <img src={shown[open].url} alt={shown[open].caption} className="max-h-[80vh] mx-auto rounded-xl object-contain" />
            <figcaption className="text-center text-white/80 mt-3">{shown[open].caption}</figcaption>
          </figure>
          {shown.length > 1 && <button aria-label="Next" onClick={e => { e.stopPropagation(); setOpen((open + 1) % shown.length); }} className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronRight size={24} /></button>}
        </div>
      )}
    </div>
  );
};

export default GalleryModule;
