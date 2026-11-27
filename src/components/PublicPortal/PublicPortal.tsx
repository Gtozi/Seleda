/**
 * Unified Public Portal
 * Public hotel website: discovery modules and the booking engine (section=booking),
 * plus a hand-off to the guest portal (/guest). The active module lives in the URL (?section=).
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useSearchParams, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Home, Building, Calendar, Users, UtensilsCrossed, Tag, MapPin,
  User, MessageSquare, HelpCircle, Menu, X, Phone, Mail
} from 'lucide-react';
import { usePublicSettings, SubTabsContext } from './shared';
import { portalModuleOn, publicModuleKey } from '../../config/portalModules';
const BookingPage = lazy(() => import('../BookingPage'));

import HomeModule from './modules/HomeModule';
const PropertyDirectoryModule = lazy(() => import('./modules/PropertyDirectoryModule'));
const PackagesPromotionsModule = lazy(() => import('./modules/PackagesPromotionsModule'));
const MeetingsEventsModule = lazy(() => import('./modules/MeetingsEventsModule'));
const WeddingBookingModule = lazy(() => import('./modules/WeddingBookingModule'));
const RestaurantReservationsModule = lazy(() => import('./modules/RestaurantReservationsModule'));
const SpaWellnessBookingModule = lazy(() => import('./modules/SpaWellnessBookingModule'));
const ExperiencesActivitiesModule = lazy(() => import('./modules/ExperiencesActivitiesModule'));
const TransportationBookingModule = lazy(() => import('./modules/TransportationBookingModule'));
const GalleryModule = lazy(() => import('./modules/GalleryModule'));
const ReviewsTestimonialsModule = lazy(() => import('./modules/ReviewsTestimonialsModule'));
const SpecialOffersModule = lazy(() => import('./modules/SpecialOffersModule'));
const ContactLiveChatModule = lazy(() => import('./modules/ContactLiveChatModule'));
const SupportCenterModule = lazy(() => import('./modules/SupportCenterModule'));

type ModuleType =
  | 'home' | 'booking' | 'properties' | 'packages' | 'meetings' | 'weddings' | 'restaurant' | 'spa'
  | 'experiences' | 'transportation'
  | 'gallery' | 'reviews' | 'offers' | 'contact' | 'support';

const MODULES: ModuleType[] = [
  'home', 'booking', 'properties', 'packages', 'meetings', 'weddings', 'restaurant', 'spa', 'experiences', 'transportation',
  'gallery', 'reviews', 'offers', 'contact', 'support',
];
const isModule = (v: string | null): v is ModuleType => !!v && (MODULES as string[]).includes(v);

/** Seven top-level tabs; related pages live as sub-tabs inside their group. */
const NAV_GROUPS: { id: string; label: string; icon: React.ReactNode; modules: { id: ModuleType; label: string }[] }[] = [
  { id: 'home', label: 'Home', icon: <Home size={18} />, modules: [{ id: 'home', label: 'Home' }] },
  { id: 'booking', label: 'Book Rooms', icon: <Calendar size={18} />, modules: [{ id: 'booking', label: 'Book Rooms' }] },
  { id: 'stay', label: 'Stay', icon: <Building size={18} />, modules: [{ id: 'properties', label: 'Properties' }, { id: 'gallery', label: 'Gallery' }, { id: 'reviews', label: 'Reviews' }] },
  { id: 'experience', label: 'Dine & Relax', icon: <UtensilsCrossed size={18} />, modules: [{ id: 'restaurant', label: 'Dining' }, { id: 'spa', label: 'Spa' }, { id: 'experiences', label: 'Experiences' }, { id: 'transportation', label: 'Transport' }] },
  { id: 'events', label: 'Events', icon: <Users size={18} />, modules: [{ id: 'meetings', label: 'Meetings' }, { id: 'weddings', label: 'Weddings' }] },
  { id: 'offers', label: 'Offers', icon: <Tag size={18} />, modules: [{ id: 'offers', label: 'Offers' }, { id: 'packages', label: 'Packages' }] },
  { id: 'contact', label: 'Contact', icon: <MessageSquare size={18} />, modules: [{ id: 'contact', label: 'Contact us' }, { id: 'support', label: 'Help & FAQs' }] },
];
const MODULE_LABELS = NAV_GROUPS.flatMap(g => g.modules);

const PublicPortal: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section');
  const activeModule: ModuleType = isModule(section) ? section : 'home';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const settings = usePublicSettings();
  // The subdomain-resolved tenant name wins — the site is branded by whichever
  // <tenant>.seledabet.com host served it, not a hardcoded hotel name.
  const hotelName = settings.tenant?.name || settings.customHotelName || 'Hotel';

  // Portal/module visibility — managed in Admin → Portal Management and
  // delivered through /api/public/settings (moduleToggles + guest flags).
  const toggles = settings.moduleToggles;
  const portalOn = portalModuleOn(toggles, 'public');
  const moduleOn = (id: ModuleType) => portalModuleOn(toggles, publicModuleKey(id));
  const bookingOn = moduleOn('booking') && settings.publicBookingEnabled !== false;
  const isModuleOn = (id: ModuleType) => moduleOn(id) && (id !== 'booking' || bookingOn);
  const guestPortalOn = settings.guestPortalEnabled !== false && portalModuleOn(toggles, 'guest');
  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, modules: g.modules.filter(m => isModuleOn(m.id)) }))
    .filter(g => g.modules.length > 0);

  const setActiveModule = (m: string) => {
    if (m === 'account') return void (window.location.href = '/guest');
    setSearchParams(m === 'home' || !isModule(m) ? {} : { section: m });
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = activeModule === 'home' ? hotelName : `${MODULE_LABELS.find(n => n.id === activeModule)?.label || ''} · ${hotelName}`;
  }, [activeModule, hotelName]);

  // Portal disabled in Admin → Portal Management, or the requested module is
  // hidden — bounce to the first visible module (mirrors DepartmentRoute).
  const fallbackModule = visibleGroups[0]?.modules[0]?.id || null;
  if (!portalOn || visibleGroups.length === 0) {
    return <UnavailablePortal hotelName={hotelName} />;
  }
  if (!isModuleOn(activeModule)) {
    return <Navigate to={fallbackModule && fallbackModule !== 'home' ? `/public-portal?section=${fallbackModule}` : '/public-portal'} replace />;
  }

  const renderModule = () => {
    switch (activeModule) {
      case 'booking': return <BookingPage embedded />;
      case 'properties': return <PropertyDirectoryModule />;
      case 'packages': return <PackagesPromotionsModule />;
      case 'meetings': return <MeetingsEventsModule />;
      case 'weddings': return <WeddingBookingModule />;
      case 'restaurant': return <RestaurantReservationsModule />;
      case 'spa': return <SpaWellnessBookingModule />;
      case 'experiences': return <ExperiencesActivitiesModule />;
      case 'transportation': return <TransportationBookingModule />;
      case 'gallery': return <GalleryModule />;
      case 'reviews': return <ReviewsTestimonialsModule />;
      case 'offers': return <SpecialOffersModule />;
      case 'contact': return <ContactLiveChatModule />;
      case 'support': return <SupportCenterModule />;
      default: return <HomeModule onNavigate={setActiveModule} />;
    }
  };

  const activeGroup = visibleGroups.find(g => g.modules.some(m => m.id === activeModule));
  const overlay = !scrolled && !mobileMenuOpen;

  const navBtn = (active: boolean, mobile = false) =>
    `flex items-center gap-2 rounded-full font-medium transition-colors ${mobile ? 'w-full px-4 py-3' : 'px-3 py-2 text-sm'} ${
      mobile || !overlay
        ? (active ? 'bg-amber-50 text-amber-700' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900')
        : (active ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white')
    }`;

  return (
    <div className="min-h-screen bg-[#FAF6EF] overflow-x-clip">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg">Skip to content</a>

      <nav aria-label="Main" className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${overlay ? 'bg-gradient-to-b from-black/50 to-transparent' : 'bg-white/80 backdrop-blur-xl border-b border-stone-200/70 shadow-sm'}`}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <button className="flex items-center gap-3 shrink-0 text-left" onClick={() => setActiveModule('home')} aria-label={`${hotelName} home`}>
              {settings.hotelLogo ? (
                <img src={settings.hotelLogo} alt="" className="w-10 h-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-700 rounded-lg flex items-center justify-center text-white font-bold text-xl">{hotelName.charAt(0)}</div>
              )}
              <div className="leading-tight">
                <span className={`block text-lg font-bold font-serif tracking-tight transition-colors ${overlay ? 'text-white' : 'text-stone-900'}`}>{hotelName}</span>
                {settings.publicTagline && <span className={`hidden sm:block text-xs max-w-[220px] truncate transition-colors ${overlay ? 'text-white/70' : 'text-stone-500'}`}>{settings.publicTagline}</span>}
              </div>
            </button>

            <div className="hidden xl:flex items-center gap-1">
              {visibleGroups.map(item => (
                <button key={item.id} onClick={() => setActiveModule(item.modules[0].id)} aria-current={activeGroup?.id === item.id ? 'page' : undefined} className={navBtn(activeGroup?.id === item.id)}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {guestPortalOn && (
                <Link to="/guest" className={`hidden sm:flex items-center gap-2 px-4 py-2 border rounded-full transition-colors text-sm font-medium ${overlay ? 'border-white/40 text-white hover:bg-white/10' : 'border-stone-300 text-stone-700 hover:bg-stone-100'}`}>
                  <User size={18} /><span>Guest Login</span>
                </Link>
              )}
              {bookingOn && (
                <Link to="/public-portal?section=booking" className={`flex items-center gap-2 px-5 py-2 rounded-full transition-colors text-sm font-semibold shadow-sm ${overlay ? 'bg-white text-stone-900 hover:bg-amber-50' : 'bg-stone-900 text-white hover:bg-stone-800'}`}>
                  <Calendar size={18} /><span>Book Now</span>
                </Link>
              )}
              <button onClick={() => setMobileMenuOpen(o => !o)} aria-expanded={mobileMenuOpen} aria-label="Toggle menu" className={`xl:hidden p-2 rounded-full transition-colors ${overlay ? 'text-white hover:bg-white/10' : 'hover:bg-stone-100'}`}>
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="xl:hidden border-t border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 max-h-[70vh] overflow-y-auto">
            <div className="px-4 py-3 space-y-1">
              {visibleGroups.map(item => (
                <button key={item.id} onClick={() => { setActiveModule(item.modules[0].id); setMobileMenuOpen(false); }} className={navBtn(activeGroup?.id === item.id, true)}>
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
              <div className="pt-3 border-t border-stone-200 dark:border-stone-700 space-y-1">
                {guestPortalOn && <Link to="/guest" className={navBtn(false, true)}><User size={18} /><span>Guest Login</span></Link>}
                <button onClick={() => { setActiveModule('support'); setMobileMenuOpen(false); }} className={navBtn(activeModule === 'support', true)}>
                  <HelpCircle size={18} /><span>Help & Support</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      <main id="portal-main" className={activeModule === 'home' ? 'w-full' : activeModule === 'booking' ? 'w-full' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8'}>
        <SubTabsContext.Provider value={activeGroup ? { tabs: activeGroup.modules, active: activeModule, onSelect: setActiveModule } : null}>
        <AnimatePresence mode="wait">
          <motion.div key={activeModule} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <Suspense fallback={<div className="min-h-[50vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" role="status" aria-label="Loading" /></div>}>
              {renderModule()}
            </Suspense>
          </motion.div>
        </AnimatePresence>
        </SubTabsContext.Provider>
      </main>

      <footer className="bg-stone-950 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-lg font-bold mb-4">{hotelName}</h3>
              {settings.publicTagline && <p className="text-stone-400 text-sm mb-4">{settings.publicTagline}</p>}
              <div className="space-y-2 text-sm">
                {settings.customHotelAddress && <div className="flex items-center gap-2 text-stone-400"><MapPin size={16} /><span>{settings.customHotelAddress}</span></div>}
                {settings.contactPhone && <a href={`tel:${settings.contactPhone}`} className="flex items-center gap-2 text-stone-400 hover:text-white"><Phone size={16} /><span>{settings.contactPhone}</span></a>}
                {settings.contactEmail && <a href={`mailto:${settings.contactEmail}`} className="flex items-center gap-2 text-stone-400 hover:text-white"><Mail size={16} /><span>{settings.contactEmail}</span></a>}
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <ul className="space-y-2 text-sm text-stone-400">
                <li><Link to="/public-portal?section=booking" className="hover:text-white transition-colors">Book Rooms</Link></li>
                <li><button onClick={() => setActiveModule('packages')} className="hover:text-white transition-colors">Packages</button></li>
                <li><button onClick={() => setActiveModule('restaurant')} className="hover:text-white transition-colors">Dining</button></li>
                <li><button onClick={() => setActiveModule('spa')} className="hover:text-white transition-colors">Spa & Wellness</button></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-stone-400">
                <li><button onClick={() => setActiveModule('support')} className="hover:text-white transition-colors">Help & FAQs</button></li>
                <li><button onClick={() => setActiveModule('contact')} className="hover:text-white transition-colors">Contact Us</button></li>
                <li><Link to="/guest" className="hover:text-white transition-colors">Guest Portal</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-stone-800 mt-8 pt-8 text-center text-stone-400 text-sm">
            <p>&copy; {new Date().getFullYear()} {hotelName}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicPortal;

const UnavailablePortal: React.FC<{ hotelName: string }> = ({ hotelName }) => (
  <div className="min-h-screen bg-[#FAF6EF] flex items-center justify-center px-6">
    <div className="text-center max-w-md">
      <h1 className="font-serif text-3xl font-bold text-stone-900">{hotelName}</h1>
      <p className="mt-3 text-stone-500">This portal is currently unavailable. Please check back later.</p>
    </div>
  </div>
);
