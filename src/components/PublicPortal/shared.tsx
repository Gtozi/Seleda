import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export interface PublicSettings {
  customHotelName?: string;
  customHotelAddress?: string;
  publicTagline?: string;
  heroImageUrl?: string;
  hotelLogo?: string;
  erpLogo?: string;
  erpName?: string;
  contactPhone?: string;
  contactEmail?: string;
  checkInTime?: string;
  checkOutTime?: string;
  starRating?: string;
  publicBookingEnabled?: boolean;
  guestPortalEnabled?: boolean;
  moduleToggles?: Record<string, boolean>;
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  bookingHeroTitle?: string;
  bookingHeroDescription?: string;
  bookingTerms?: string;
  policySections?: { id: string; title: string; content: string }[];
  cancellationGraceHours?: number;
  cancellationPenaltyPercent?: number;
  /** Resolved from the request subdomain by the server — the tenant this site belongs to. */
  tenant?: { id: string; name: string; code: string; logoUrl?: string | null } | null;
}

let settingsPromise: Promise<PublicSettings> | null = null;
const loadSettings = () => {
  if (!settingsPromise) {
    settingsPromise = fetch('/api/public/settings', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : { settings: {} }))
      .then(d => (d.settings || {}) as PublicSettings)
      .catch(() => {
        settingsPromise = null;
        return {} as PublicSettings;
      });
  }
  return settingsPromise;
};

/** Hotel branding/contact info from the admin-managed public settings (cached). */
export const usePublicSettings = () => {
  const [settings, setSettings] = useState<PublicSettings>({});
  useEffect(() => {
    let alive = true;
    loadSettings().then(s => alive && setSettings(s));
    const unsubscribe = subscribeLive(urls => {
      if (!urls.includes('/api/public/settings')) return;
      settingsPromise = null;
      loadSettings().then(s => alive && setSettings(s));
    });
    return () => { alive = false; unsubscribe(); };
  }, []);
  return settings;
};

// ── Live updates ─────────────────────────────────────────────────────────
// One shared EventSource (/api/public/live). The server names the topic that changed; we drop
// the cached responses for it and every mounted hook showing that data refetches.
const TOPIC_URLS: Record<string, string[]> = {
  offers: ['/api/public/special-offers'],
  reviews: ['/api/public/reviews'],
  properties: ['/api/public/properties'],
  packages: ['/api/public/packages'],
  dining: ['/api/public/restaurants'],
  venues: ['/api/public/venues'],
  spa: ['/api/public/spa-treatments'],
  services: ['/api/public/experiences', '/api/public/guest-services'],
  gallery: ['/api/public/gallery', '/api/public/properties'],
  settings: ['/api/public/settings'],
};
const ALL_LIVE_URLS = Array.from(new Set(Object.values(TOPIC_URLS).flat()));
type LiveListener = (urls: string[]) => void;
const liveListeners = new Set<LiveListener>();
let liveSource: EventSource | null = null;

const notifyLive = (urls: string[]) => {
  urls.forEach(u => responseCache.delete(u));
  liveListeners.forEach(l => l(urls));
};
const openLive = () => {
  if (liveSource || typeof EventSource === 'undefined' || document.hidden) return;
  liveSource = new EventSource('/api/public/live');
  liveSource.addEventListener('change', e => {
    try {
      const { topic } = JSON.parse((e as MessageEvent).data);
      if (TOPIC_URLS[topic]) notifyLive(TOPIC_URLS[topic]);
    } catch { /* ignore malformed event */ }
  });
};
const closeLive = () => { liveSource?.close(); liveSource = null; };
if (typeof document !== 'undefined') {
  // Save server load while the tab is in the background; catch up when it returns.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return closeLive();
    if (liveListeners.size) { openLive(); notifyLive(ALL_LIVE_URLS); }
  });
}
const subscribeLive = (l: LiveListener) => {
  liveListeners.add(l);
  openLive();
  return () => {
    liveListeners.delete(l);
    if (!liveListeners.size) closeLive();
  };
};

// Shared response cache: tab switches reuse data instantly and revalidate in the background;
// concurrent requests for the same URL are de-duplicated.
const CACHE_TTL_MS = 60_000;
const responseCache = new Map<string, { at: number; json: any }>();
const inflight = new Map<string, Promise<any>>();
const getJson = (url: string, fresh = false): Promise<any> => {
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = fetch(url, fresh ? { cache: 'no-cache' } : undefined)
    .then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Failed to load');
      responseCache.set(url, { at: Date.now(), json: j });
      return j;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
};

/** GET a public endpoint (cached, stale-while-revalidate) and pick data out of the response. */
export const usePublicData = <T,>(url: string, pick: (json: any) => T, initial: T) => {
  const cached = responseCache.get(url);
  const [data, setData] = useState<T>(cached ? pick(cached.json) : initial);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    const hit = responseCache.get(url);
    if (hit) setData(pick(hit.json));
    setLoading(!hit);
    setError('');
    if (hit && nonce === 0 && Date.now() - hit.at < CACHE_TTL_MS) return () => { alive = false; };
    getJson(url)
      .then(j => alive && setData(pick(j)))
      .catch(e => alive && !hit && setError(e.message || 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce]);
  useEffect(() => subscribeLive(urls => {
    if (!urls.includes(url)) return;
    getJson(url, true).then(j => setData(pick(j))).catch(() => { /* keep showing the last good data */ });
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [url]);
  const retry = useCallback(() => { responseCache.delete(url); setNonce(n => n + 1); }, [url]);
  return { data, loading, error, retry };
};

export const formatMoney = (n: number) => `$${Number(n || 0).toLocaleString()}`;

/** Submit a public inquiry form. */
export const useInquiry = (url: string) => {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const submit = async (body: Record<string, unknown>) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.details ? 'Please check the form fields and try again.' : j.error || 'Submission failed');
      setDone(true);
      return true;
    } catch (e: any) {
      setError(e.message || 'Submission failed');
      return false;
    } finally {
      setSubmitting(false);
    }
  };
  return { submit, submitting, done, error, reset: () => { setDone(false); setError(''); } };
};

/** Fade-up on scroll. */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({ children, delay = 0, className }) => (
  <motion.div className={className} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay, ease: 'easeOut' }}>
    {children}
  </motion.div>
);

/** Staggered grid: children animate in one after another. */
export const RevealGrid: React.FC<{ children: React.ReactNode[] | React.ReactNode; className: string }> = ({ children, className }) => (
  <div className={className}>
    {(Array.isArray(children) ? children : [children]).map((c, i) => <Reveal key={i} delay={Math.min(i, 8) * 0.05} className="h-full">{c}</Reveal>)}
  </div>
);

/** Sub-tabs of the current nav group; ModuleHeader renders them inside the hero. */
export interface SubTabsValue { tabs: { id: string; label: string }[]; active: string; onSelect: (id: string) => void }
export const SubTabsContext = createContext<SubTabsValue | null>(null);

/** Default hero photo per tab (falls back to the hotel's own hero image if one fails to load). */
const unsplash = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&q=80&w=1920`;
export const HERO = {
  booking: unsplash('photo-1631049307264-da0ec9d70304'),
  properties: unsplash('photo-1542314831-068cd1dbfeeb'),
  gallery: unsplash('photo-1582719508461-905c673771fd'),
  reviews: unsplash('photo-1571896349842-33c89424de2d'),
  dining: unsplash('photo-1517248135467-4c7edcad34c4'),
  spa: unsplash('photo-1544161515-4ab6ce6db874'),
  experiences: unsplash('photo-1520250497591-112f2f40a3f4'),
  transport: unsplash('photo-1449965408869-eaa3f722e40d'),
  weddings: unsplash('photo-1519741497674-611481863552'),
  meetings: unsplash('photo-1431540015161-0bf868a2d407'),
  offers: unsplash('photo-1414235077428-338989a2e8c0'),
  packages: unsplash('photo-1540555700478-4be289fbecef'),
  contact: unsplash('photo-1423666639041-f56000c27a9a'),
  support: unsplash('photo-1551882547-ff40c63fe5fa'),
} as const;

/** Full-bleed image hero shared by every tab — same look as the home page. */
export const ModuleHeader: React.FC<{ title: string; subtitle: string; gradient: string; eyebrow?: string; image?: string; children?: React.ReactNode }> = ({ title, subtitle, gradient, eyebrow, image, children }) => {
  const settings = usePublicSettings();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [image]);
  const heroSrc = (!imageFailed && image) || settings.heroImageUrl;
  const subTabs = useContext(SubTabsContext);
  return (
    <header className="relative left-1/2 -ml-[50vw] w-screen overflow-hidden bg-stone-950 text-white mb-10 md:mb-14">
      {heroSrc && <img key={heroSrc} src={heroSrc} alt="" aria-hidden decoding="async" onError={() => setImageFailed(true)} className="absolute inset-0 w-full h-full object-cover opacity-70" />}
      <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-60 mix-blend-multiply`} />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-stone-950/70 via-stone-950/30 to-stone-950/80" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-10 md:pt-40 md:pb-14 min-h-[340px] md:min-h-[420px] flex flex-col justify-end">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 mb-5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold tracking-[0.18em] uppercase">
            {eyebrow || settings.customHotelName || 'Welcome'}
          </span>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] max-w-3xl drop-shadow-lg">{title}</h1>
          <p className="mt-4 text-base md:text-xl text-white/85 max-w-2xl leading-relaxed">{subtitle}</p>
          {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
        </motion.div>
        {subTabs && subTabs.tabs.length > 1 && (
          <div role="tablist" className="mt-8 flex flex-wrap gap-2">
            {subTabs.tabs.map(t => (
              <button key={t.id} role="tab" aria-selected={t.id === subTabs.active} onClick={() => subTabs.onSelect(t.id)}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors backdrop-blur-md border ${t.id === subTabs.active ? 'bg-white text-stone-900 border-white' : 'bg-white/10 text-white border-white/25 hover:bg-white/20'}`}>{t.label}</button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
};

/** Eyebrow label + serif heading used above every content section. */
export const SectionHead: React.FC<{ eyebrow: string; title: string; action?: React.ReactNode }> = ({ eyebrow, title, action }) => (
  <div className="flex items-end justify-between gap-4 mb-8">
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600 mb-2">{eyebrow}</p>
      <h2 className="font-serif text-3xl md:text-4xl font-bold text-stone-900 tracking-tight">{title}</h2>
    </div>
    {action}
  </div>
);

/** Shared card surface (matches the home page cards). */
export const cardClass = 'bg-white rounded-3xl border border-stone-200/70 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300';

export const LoadingGrid: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="bg-white dark:bg-stone-800 rounded-xl p-6 shadow animate-pulse space-y-3">
        <div className="h-5 bg-stone-200 dark:bg-stone-700 rounded w-2/3" />
        <div className="h-3 bg-stone-200 dark:bg-stone-700 rounded w-full" />
        <div className="h-3 bg-stone-200 dark:bg-stone-700 rounded w-1/2" />
      </div>
    ))}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="text-center py-14 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl">
    <p className="font-semibold text-stone-700 dark:text-stone-200">{title}</p>
    {hint && <p className="text-sm text-stone-500 mt-1">{hint}</p>}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl">
    <AlertCircle size={18} className="shrink-0" />
    <span className="flex-1">{message}</span>
    {onRetry && <button onClick={onRetry} className="font-semibold underline">Retry</button>}
  </div>
);

export const InquiryStatus: React.FC<{ done: boolean; error: string; successText: string }> = ({ done, error, successText }) => (
  <>
    {done && (
      <div role="status" className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg">
        <CheckCircle2 size={18} /> {successText}
      </div>
    )}
    {error && <ErrorState message={error} />}
  </>
);

export const SubmitButton: React.FC<{ submitting: boolean; className: string; children: React.ReactNode }> = ({ submitting, className, children }) => (
  <button type="submit" disabled={submitting} className={`${className} disabled:opacity-60 flex items-center justify-center gap-2`}>
    {submitting ? <Loader2 size={18} className="animate-spin" /> : null}
    {children}
  </button>
);

export const inputClass = 'w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:bg-white focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition';
