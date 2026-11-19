/**
 * Home Module
 * Landing page — immersive hero, glass booking bar, live stats, offers, properties and reviews.
 * Everything shown comes from the ERP (settings, properties, promotions, testimonials).
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Calendar, MapPin, Star, ArrowRight, Sparkles, UtensilsCrossed, Heart, Building, Car, Award,
  Search, ShieldCheck, Tag, Headphones, Users, ChevronDown, Quote
} from 'lucide-react';
import { formatMoney, usePublicData, usePublicSettings } from '../shared';

interface HomeModuleProps {
  onNavigate?: (module: string) => void;
}

interface Offer { id: string; title: string; discount: string; description: string; validUntil: string }
interface Property { id: string; name: string; location: string; description: string; imageUrl: string; startingPrice: number; rating: number | null; reviewCount: number; amenities: string[]; starRating: number | null; roomCount: number }
interface Review { id: string; name: string; location: string; rating: number; comment: string }

const FALLBACK_HERO = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=1920';
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return toISO(d); };

const quickActions = [
  { label: 'Book Rooms', icon: <Calendar size={20} />, module: 'booking', tint: 'bg-amber-100 text-amber-700' },
  { label: 'Dining', icon: <UtensilsCrossed size={20} />, module: 'restaurant', tint: 'bg-rose-100 text-rose-600' },
  { label: 'Spa & Wellness', icon: <Sparkles size={20} />, module: 'spa', tint: 'bg-purple-100 text-purple-600' },
  { label: 'Experiences', icon: <MapPin size={20} />, module: 'experiences', tint: 'bg-emerald-100 text-emerald-600' },
  { label: 'Weddings', icon: <Heart size={20} />, module: 'weddings', tint: 'bg-pink-100 text-pink-600' },
  { label: 'Meetings & Events', icon: <Building size={20} />, module: 'meetings', tint: 'bg-blue-100 text-blue-600' },
  { label: 'Transport', icon: <Car size={20} />, module: 'transportation', tint: 'bg-orange-100 text-orange-600' },
  { label: 'Special Offers', icon: <Award size={20} />, module: 'offers', tint: 'bg-red-100 text-red-600' },
];

const fieldCls = 'w-full bg-transparent text-stone-900 font-medium text-sm outline-none';

const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({ children, delay = 0, className }) => (
  <motion.div className={className} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.55, delay, ease: 'easeOut' }}>
    {children}
  </motion.div>
);

const SectionHead: React.FC<{ eyebrow: string; title: string; action?: React.ReactNode }> = ({ eyebrow, title, action }) => (
  <div className="flex items-end justify-between gap-4 mb-8">
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600 mb-2">{eyebrow}</p>
      <h2 className="font-serif text-3xl md:text-4xl font-bold text-stone-900 tracking-tight">{title}</h2>
    </div>
    {action}
  </div>
);

const HomeModule: React.FC<HomeModuleProps> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const settings = usePublicSettings();
  const [checkIn, setCheckIn] = useState(addDays(1));
  const [checkOut, setCheckOut] = useState(addDays(2));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  const { data: offers } = usePublicData<Offer[]>('/api/public/special-offers', j => j.offers || [], []);
  const { data: properties } = usePublicData<Property[]>('/api/public/properties', j => j.properties || [], []);
  const { data: reviews } = usePublicData<Review[]>('/api/public/reviews', j => (j.reviews || []).slice(0, 3), []);

  const hotelName = settings.customHotelName || 'Our Hotel';
  const heroImage = settings.heroImageUrl || FALLBACK_HERO;
  const customTitle = settings.bookingHeroTitle && settings.bookingHeroTitle !== 'Find your perfect stay';

  const stats = useMemo(() => {
    const rated = properties.filter(p => p.rating != null);
    const avg = rated.length ? rated.reduce((s, p) => s + (p.rating || 0), 0) / rated.length : 0;
    const reviewCount = properties.reduce((s, p) => s + (p.reviewCount || 0), 0);
    const rooms = properties.reduce((s, p) => s + (p.roomCount || 0), 0);
    return [
      properties.length > 0 && { value: String(properties.length), label: properties.length === 1 ? 'Property' : 'Properties' },
      rooms > 0 && { value: String(rooms), label: 'Rooms & suites' },
      avg > 0 && { value: avg.toFixed(1), label: 'Guest rating' },
      reviewCount > 0 && { value: String(reviewCount), label: 'Guest reviews' },
      settings.checkInTime && { value: settings.checkInTime, label: 'Check-in from' },
    ].filter(Boolean) as { value: string; label: string }[];
  }, [properties, settings.checkInTime]);

  const onCheckIn = (v: string) => {
    setCheckIn(v);
    if (v && checkOut <= v) {
      const d = new Date(v);
      d.setDate(d.getDate() + 1);
      setCheckOut(toISO(d));
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/public-portal?${new URLSearchParams({ section: 'booking', checkIn, checkOut, adults: String(adults), children: String(children) })}`);
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative min-h-[100svh] w-full overflow-hidden bg-stone-950 flex flex-col">
        <motion.img
          src={heroImage}
          alt=""
          fetchPriority="high"
          decoding="async"
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 8, ease: 'easeOut' }}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-stone-950/60 via-stone-950/30 to-stone-950/85" />

        <div className="relative flex-1 flex flex-col items-center justify-center text-center text-white px-4 sm:px-8 pt-28 pb-44">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="inline-flex items-center gap-2 px-4 py-1.5 mb-6 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold tracking-[0.18em] uppercase">
            {settings.starRating && <span className="text-amber-300">{'★'.repeat(Math.min(5, parseInt(settings.starRating) || 0))}</span>}
            <span>Direct reservations</span>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }} className="font-serif text-5xl md:text-7xl font-bold tracking-tight max-w-4xl leading-[1.05] drop-shadow-lg">
            {customTitle ? settings.bookingHeroTitle : <>Welcome to <span className="text-amber-300">{hotelName}</span></>}
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2 }} className="mt-6 text-lg md:text-xl text-white/85 max-w-2xl leading-relaxed">
            {settings.publicTagline || settings.bookingHeroDescription || 'Book direct for the best available rates and personalised service.'}
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.3 }} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/public-portal?section=booking" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-amber-400 hover:bg-amber-300 text-stone-900 font-semibold transition-colors shadow-lg shadow-amber-900/30">
              Book your stay <ArrowRight size={18} />
            </Link>
            <button onClick={() => onNavigate?.('properties')} className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/30 text-white font-semibold transition-colors">
              Explore
            </button>
          </motion.div>
        </div>

        {/* Floating booking bar */}
        <motion.form
          onSubmit={handleSearch}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45 }}
          className="absolute bottom-10 inset-x-4 md:inset-x-8 mx-auto max-w-5xl bg-white/95 backdrop-blur-xl rounded-3xl md:rounded-full shadow-2xl shadow-black/40 p-3 md:pl-8 md:pr-3 md:py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-0"
        >
          <label htmlFor="h-in" className="flex-1 md:pr-4 md:border-r border-stone-200 px-3 md:px-0 pt-1">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-stone-400">Check in</span>
            <input id="h-in" type="date" required min={toISO(new Date())} value={checkIn} onChange={e => onCheckIn(e.target.value)} className={fieldCls} />
          </label>
          <label htmlFor="h-out" className="flex-1 md:px-4 md:border-r border-stone-200 px-3">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-stone-400">Check out</span>
            <input id="h-out" type="date" required min={checkIn} value={checkOut} onChange={e => setCheckOut(e.target.value)} className={fieldCls} />
          </label>
          <div className="flex-1 md:px-4 px-3 flex items-center gap-3">
            <Users size={18} className="text-stone-400 shrink-0" />
            <label htmlFor="h-ad" className="flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-stone-400">Adults</span>
              <select id="h-ad" value={adults} onChange={e => setAdults(Number(e.target.value))} className={fieldCls}>
                {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label htmlFor="h-ch" className="flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-stone-400">Children</span>
              <select id="h-ch" value={children} onChange={e => setChildren(Number(e.target.value))} className={fieldCls}>
                {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" className="md:ml-2 inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-stone-900 hover:bg-stone-800 text-white font-semibold transition-colors">
            <Search size={18} /> Check availability
          </button>
        </motion.form>

        <ChevronDown aria-hidden size={22} className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/60 animate-bounce hidden md:block" />
      </section>

      {/* Live stats */}
      {stats.length > 0 && (
        <div className="bg-stone-950 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
            {stats.map(s => (
              <div key={s.label}>
                <div className="font-serif text-3xl font-bold text-amber-300">{s.value}</div>
                <div className="text-xs uppercase tracking-widest text-white/60 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 space-y-20">
        {/* Discover */}
        <section aria-labelledby="qa-title">
          <Reveal><SectionHead eyebrow="Discover" title="Everything for your stay" /></Reveal>
          <h2 id="qa-title" className="sr-only">Quick actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickActions.map((a, i) => (
              <Reveal key={a.module} delay={i * 0.04}>
                <button onClick={() => onNavigate?.(a.module)} className="group w-full text-left bg-white border border-stone-200/70 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-900/5 hover:-translate-y-1 p-5 rounded-3xl transition-all focus-visible:ring-4 ring-amber-200 outline-none flex items-center gap-4">
                  <span className={`${a.tint} w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>{a.icon}</span>
                  <span className="font-semibold text-stone-800 text-sm leading-snug flex-1">{a.label}</span>
                  <ArrowRight size={16} className="text-stone-300 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
                </button>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Offers */}
        {offers.length > 0 && (
          <section aria-labelledby="offers-title">
            <Reveal>
              <SectionHead eyebrow="Offers" title="Featured offers" action={<button onClick={() => onNavigate?.('offers')} className="hidden sm:flex items-center gap-2 text-amber-700 hover:text-amber-800 font-semibold">View all <ArrowRight size={18} /></button>} />
            </Reveal>
            <h2 id="offers-title" className="sr-only">Featured offers</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {offers.slice(0, 3).map((o, i) => (
                <Reveal key={o.id} delay={i * 0.08}>
                  <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-stone-900 via-stone-800 to-amber-900 text-white p-7 flex flex-col h-full min-h-[240px]">
                    <div aria-hidden className="absolute -right-10 -top-10 w-44 h-44 rounded-full bg-amber-400/20 blur-2xl" />
                    <span className="relative self-start bg-amber-400 text-stone-900 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1.5"><Tag size={14} /> {o.discount}</span>
                    <h3 className="relative font-serif text-2xl font-bold mt-5">{o.title}</h3>
                    {o.description && <p className="relative text-sm text-white/75 mt-2">{o.description}</p>}
                    {o.validUntil && <p className="relative text-xs text-white/50 mt-3">Valid until {o.validUntil}</p>}
                    <Link to="/public-portal?section=booking" className="relative mt-auto pt-5 inline-flex items-center gap-2 font-semibold text-amber-300 hover:text-amber-200">Book now <ArrowRight size={16} /></Link>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* Properties */}
        {properties.length > 0 && (
          <section aria-labelledby="prop-title">
            <Reveal>
              <SectionHead eyebrow="Stay" title="Our properties" action={<button onClick={() => onNavigate?.('properties')} className="hidden sm:flex items-center gap-2 text-amber-700 hover:text-amber-800 font-semibold">View all <ArrowRight size={18} /></button>} />
            </Reveal>
            <h2 id="prop-title" className="sr-only">Our properties</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {properties.slice(0, 3).map((p, i) => (
                <Reveal key={p.id} delay={i * 0.08}>
                  <article className="group relative h-[420px] rounded-3xl overflow-hidden bg-stone-800 shadow-lg">
                    {p.imageUrl && <img src={p.imageUrl} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/30 to-transparent" />
                    {p.rating != null && (
                      <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full flex items-center gap-1">
                        <Star size={14} className="text-amber-500 fill-amber-500" /><span className="text-sm font-semibold text-stone-900">{p.rating}</span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                      <h3 className="font-serif text-2xl font-bold">{p.name}</h3>
                      {p.location && <div className="flex items-center gap-1.5 text-white/75 text-sm mt-1"><MapPin size={14} /><span>{p.location}</span></div>}
                      {p.amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {p.amenities.slice(0, 3).map(a => <span key={a} className="text-xs bg-white/15 backdrop-blur-sm px-2.5 py-1 rounded-full">{a}</span>)}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-5">
                        {p.startingPrice > 0 ? <div><span className="text-xs text-white/60">From </span><span className="text-2xl font-bold text-amber-300">{formatMoney(p.startingPrice)}</span><span className="text-white/60 text-sm"> / night</span></div> : <span />}
                        <Link to="/public-portal?section=booking" className="bg-white text-stone-900 hover:bg-amber-100 px-5 py-2 rounded-full font-semibold text-sm transition-colors">Book</Link>
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <section aria-labelledby="rev-title">
            <Reveal>
              <SectionHead eyebrow="Guest stories" title="What our guests say" action={<button onClick={() => onNavigate?.('reviews')} className="hidden sm:flex items-center gap-2 text-amber-700 hover:text-amber-800 font-semibold">All reviews <ArrowRight size={18} /></button>} />
            </Reveal>
            <h2 id="rev-title" className="sr-only">Guest reviews</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {reviews.map((r, i) => (
                <Reveal key={r.id} delay={i * 0.08}>
                  <figure className="relative bg-white rounded-3xl p-7 border border-stone-200/70 h-full">
                    <Quote aria-hidden size={36} className="absolute top-5 right-5 text-amber-100" />
                    <div className="flex mb-4" aria-label={`${r.rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={16} className={n <= r.rating ? 'text-amber-500 fill-amber-500' : 'text-stone-300'} />)}</div>
                    <blockquote className="text-stone-700 leading-relaxed mb-5 line-clamp-5">{r.comment}</blockquote>
                    <figcaption className="text-sm font-semibold text-stone-900">{r.name}{r.location && <span className="text-stone-500 font-normal"> · {r.location}</span>}</figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* Why book direct */}
        <Reveal>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: <Award size={26} />, title: 'Direct rates', text: 'Best available rates, straight from the hotel — no middleman.' },
              { icon: <ShieldCheck size={26} />, title: 'Secure booking', text: 'Your reservation goes directly into the hotel\'s own system.' },
              { icon: <Headphones size={26} />, title: 'Personal service', text: 'Talk to the hotel team about special requests before you arrive.' },
            ].map(f => (
              <div key={f.title} className="flex gap-4 p-6 rounded-3xl bg-amber-50/70 border border-amber-100">
                <div className="w-12 h-12 shrink-0 rounded-2xl bg-white text-amber-600 flex items-center justify-center shadow-sm">{f.icon}</div>
                <div>
                  <h3 className="font-semibold text-stone-900">{f.title}</h3>
                  <p className="text-sm text-stone-600 mt-1 leading-relaxed">{f.text}</p>
                </div>
              </div>
            ))}
          </section>
        </Reveal>

        {/* Closing CTA */}
        <Reveal>
          <section className="relative overflow-hidden rounded-[2rem] bg-stone-900 text-white px-8 py-14 md:px-16 text-center">
            <div aria-hidden className="absolute -left-20 -bottom-24 w-72 h-72 rounded-full bg-amber-500/20 blur-3xl" />
            <div aria-hidden className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-amber-300/10 blur-3xl" />
            <h2 className="relative font-serif text-3xl md:text-5xl font-bold tracking-tight">Ready for your stay?</h2>
            <p className="relative text-white/70 mt-3 max-w-xl mx-auto">Choose your dates and book directly with {hotelName}.</p>
            <Link to="/public-portal?section=booking" className="relative inline-flex items-center gap-2 mt-8 px-8 py-3.5 rounded-full bg-amber-400 hover:bg-amber-300 text-stone-900 font-semibold transition-colors">
              Book now <ArrowRight size={18} />
            </Link>
          </section>
        </Reveal>
      </div>
    </div>
  );
};

export default HomeModule;
