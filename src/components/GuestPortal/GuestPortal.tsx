/**
 * Unified Guest Portal
 * Main component integrating all guest portal modules
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom';
import {
  Home,
  User,
  Calendar,
  LogIn,
  Key,
  Bed,
  UtensilsCrossed,
  ChefHat,
  ConciergeBell,
  Car,
  Wrench,
  Sparkles,
  Building,
  Award,
  CreditCard,
  Receipt,
  MessageSquare,
  Bell,
  Star,
  HelpCircle,
  Settings,
  Menu,
  X,
  Lock,
  Loader2
} from 'lucide-react';

// Import all modules
import HomeDashboardModule from './modules/HomeDashboardModule';
import ProfilePreferencesModule from './modules/ProfilePreferencesModule';
import ReservationsModule from './modules/ReservationsModule';
import DigitalCheckinModule from './modules/DigitalCheckinModule';
import DigitalRoomKeyModule from './modules/DigitalRoomKeyModule';
import MyStayModule from './modules/MyStayModule';
import RoomServiceModule from './modules/RoomServiceModule';
import RestaurantReservationsModule from './modules/RestaurantReservationsModule';
import SpaWellnessModule from './modules/SpaWellnessModule';
import ConciergeServicesModule from './modules/ConciergeServicesModule';
import TransportationModule from './modules/TransportationModule';
import HousekeepingRequestsModule from './modules/HousekeepingRequestsModule';
import MaintenanceRequestsModule from './modules/MaintenanceRequestsModule';
import EventActivityBookingModule from './modules/EventActivityBookingModule';
import MeetingBanquetServicesModule from './modules/MeetingBanquetServicesModule';
import LoyaltyProgramModule from './modules/LoyaltyProgramModule';
import WalletPaymentsModule from './modules/WalletPaymentsModule';
import BillingFolioModule from './modules/BillingFolioModule';
import MessagingCenterModule from './modules/MessagingCenterModule';
import NotificationsModule from './modules/NotificationsModule';
import FeedbackReviewsModule from './modules/FeedbackReviewsModule';
import HelpCenterModule from './modules/HelpCenterModule';
import SettingsModule from './modules/SettingsModule';
import { usePublicSettings } from '../PublicPortal/shared';
import { portalModuleOn, guestModuleKey } from '../../config/portalModules';

interface GuestPortalProps {
  reservationId?: string;
  guestId?: string;
}

type ModuleType = 
  | 'dashboard'
  | 'profile'
  | 'reservations'
  | 'checkin'
  | 'digitalKey'
  | 'myStay'
  | 'roomService'
  | 'restaurant'
  | 'spa'
  | 'concierge'
  | 'transportation'
  | 'housekeeping'
  | 'maintenance'
  | 'events'
  | 'meetings'
  | 'loyalty'
  | 'wallet'
  | 'billing'
  | 'messaging'
  | 'notifications'
  | 'feedback'
  | 'help'
  | 'settings';

// URL-driven tabs: /guest/:tab — kebab-case slugs map to camelCase module ids,
// mirroring the /erp/:department/:tab scheme used by DepartmentRoute.
const MODULE_SLUGS: Record<ModuleType, string> = {
  dashboard: 'dashboard',
  profile: 'profile',
  reservations: 'reservations',
  checkin: 'checkin',
  digitalKey: 'digital-key',
  myStay: 'my-stay',
  roomService: 'room-service',
  restaurant: 'restaurant',
  spa: 'spa',
  concierge: 'concierge',
  transportation: 'transportation',
  housekeeping: 'housekeeping',
  maintenance: 'maintenance',
  events: 'events',
  meetings: 'meetings',
  loyalty: 'loyalty',
  wallet: 'wallet',
  billing: 'billing',
  messaging: 'messaging',
  notifications: 'notifications',
  feedback: 'feedback',
  help: 'help',
  settings: 'settings'
};

const SLUG_TO_MODULE: Record<string, ModuleType> = Object.fromEntries(
  Object.entries(MODULE_SLUGS).map(([mod, slug]) => [slug, mod as ModuleType])
);

interface GuestIdentity {
  guestId: string;
  name: string;
  forcePasswordChange: boolean;
}

// Sign-in screen shown when the visitor has no guest session and no
// guestId+reservationId bearer link. Username = guest name as on the
// booking; first-login password = the guest's own id.
const GuestLoginScreen: React.FC<{ onSuccess: (g: GuestIdentity) => void }> = ({ onSuccess }) => {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !name.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/guest-portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Sign in failed');
      onSuccess(payload as GuestIdentity);
    } catch (err: any) {
      setError(err?.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-lg p-6 sm:p-8">
        <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Guest Portal</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Sign in with your name as it appears on your booking.
        </p>
        {error && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Full name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="w-full mb-4 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="e.g. John Smith"
          required
        />
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full mb-6 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          required
        />
        <button
          type="submit"
          disabled={submitting || !name.trim() || !password}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500 text-center">
          First time? Your password is your guest ID from the booking confirmation.
        </p>
      </form>
    </div>
  );
};

// Forced first-login password change — shown until the guest picks a real
// password (the server also blocks every non-/auth endpoint until then).
const GuestPasswordChangeScreen: React.FC<{ guestName?: string; onDone: () => void }> = ({ guestName, onDone }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/guest-portal/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to change password');
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-lg p-6 sm:p-8">
        <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Set your password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {guestName ? `Welcome, ${guestName}. ` : ''}For security, choose a new password to continue.
        </p>
        {error && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className="w-full mb-4 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          required
        />
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className="w-full mb-6 px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          required
        />
        <button
          type="submit"
          disabled={submitting || !newPassword || !confirmPassword}
          className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </div>
  );
};

const GuestPortal: React.FC<GuestPortalProps> = ({
  reservationId: reservationIdProp,
  guestId: guestIdProp
}) => {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const publicSettings = usePublicSettings();

  // Guest auth gate: 'checking' while the session is resolved, 'login' when
  // there is no session and no bearer link, 'changePassword' for the forced
  // first-login change, 'ready' to render the portal.
  const [authState, setAuthState] = useState<'checking' | 'login' | 'changePassword' | 'ready'>('checking');
  const [sessionGuest, setSessionGuest] = useState<GuestIdentity | null>(null);

  const hasBearerContext = !!(guestIdProp || searchParams.get('guestId') || sessionStorage.getItem('guest_portal_guest_id'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guest-portal/auth/session', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          if (data.type === 'guest') {
            setSessionGuest({ guestId: data.guestId, name: data.name, forcePasswordChange: !!data.forcePasswordChange });
            sessionStorage.setItem('guest_portal_guest_id', data.guestId);
            setAuthState(data.forcePasswordChange ? 'changePassword' : 'ready');
            return;
          }
          // Staff session — portal access governed by the bearer context.
          setAuthState('ready');
          return;
        }
        if (!cancelled) setAuthState(hasBearerContext ? 'ready' : 'login');
      } catch {
        if (!cancelled) setAuthState(hasBearerContext ? 'ready' : 'login');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the guest context: props → ?guestId=&reservationId= deep link →
  // logged-in guest session → sessionStorage.
  const guestId = guestIdProp
    || searchParams.get('guestId')
    || sessionGuest?.guestId
    || sessionStorage.getItem('guest_portal_guest_id')
    || undefined;
  const reservationId = reservationIdProp
    || searchParams.get('reservationId')
    || sessionStorage.getItem('guest_portal_reservation_id')
    || undefined;

  useEffect(() => {
    if (guestId) sessionStorage.setItem('guest_portal_guest_id', guestId);
    if (reservationId) sessionStorage.setItem('guest_portal_reservation_id', reservationId);
  }, [guestId, reservationId]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  // Browser tab title follows the subdomain-resolved tenant, like the public site.
  const portalName = publicSettings.tenant?.name || publicSettings.customHotelName || 'Hotel';
  useEffect(() => {
    const module = tab ? SLUG_TO_MODULE[tab] : undefined;
    const label = !module || module === 'dashboard'
      ? portalName
      : `${tab!.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} · ${portalName}`;
    document.title = label;
  }, [tab, portalName]);

  // Unknown tab slugs redirect to the default tab (mirrors DepartmentRoute).
  if (tab && !SLUG_TO_MODULE[tab]) {
    return <Navigate to={`/guest/${MODULE_SLUGS.dashboard}`} replace />;
  }
  const activeModule: ModuleType = (tab && SLUG_TO_MODULE[tab]) || 'dashboard';

  // Portal/module visibility — managed in Admin → Portal Management and
  // delivered through /api/public/settings (moduleToggles + guest_portal_enabled).
  const toggles = publicSettings.moduleToggles;
  const portalOn = publicSettings.guestPortalEnabled !== false && portalModuleOn(toggles, 'guest');
  const moduleOn = (id: ModuleType) => portalModuleOn(toggles, guestModuleKey(id));
  const dashboardOn = moduleOn('dashboard');
  if (!portalOn || (!moduleOn(activeModule) && !dashboardOn)) {
    return <GuestPortalUnavailable />;
  }
  if (!moduleOn(activeModule)) {
    const qs = searchParams.toString();
    return <Navigate to={`/guest/${MODULE_SLUGS.dashboard}${qs ? `?${qs}` : ''}`} replace />;
  }

  // Accepts either a ModuleType id or a URL slug so module-internal callbacks
  // (e.g. HomeDashboardModule's onViewModule) keep working. The query string
  // is preserved so ?guestId=/&reservationId= deep links survive tab switches.
  const setActiveModule = (module: string) => {
    const resolved = (module in MODULE_SLUGS ? module : SLUG_TO_MODULE[module]) as ModuleType | undefined;
    navigate({
      pathname: `/guest/${resolved ? MODULE_SLUGS[resolved] : MODULE_SLUGS.dashboard}`,
      search: searchParams.toString() ? `?${searchParams.toString()}` : ''
    });
  };

  const navigationItems = [
    { id: 'dashboard' as ModuleType, label: 'Home', icon: <Home size={20} /> },
    { id: 'profile' as ModuleType, label: 'Profile', icon: <User size={20} /> },
    { id: 'reservations' as ModuleType, label: 'Reservations', icon: <Calendar size={20} /> },
    { id: 'checkin' as ModuleType, label: 'Check-in', icon: <LogIn size={20} /> },
    { id: 'digitalKey' as ModuleType, label: 'Digital Key', icon: <Key size={20} /> },
    { id: 'myStay' as ModuleType, label: 'My Stay', icon: <Bed size={20} /> },
    { id: 'roomService' as ModuleType, label: 'Room Service', icon: <UtensilsCrossed size={20} /> },
    { id: 'restaurant' as ModuleType, label: 'Restaurant', icon: <ChefHat size={20} /> },
    { id: 'spa' as ModuleType, label: 'Spa & Wellness', icon: <Sparkles size={20} /> },
    { id: 'concierge' as ModuleType, label: 'Concierge', icon: <ConciergeBell size={20} /> },
    { id: 'transportation' as ModuleType, label: 'Transportation', icon: <Car size={20} /> },
    { id: 'housekeeping' as ModuleType, label: 'Housekeeping', icon: <Bed size={20} /> },
    { id: 'maintenance' as ModuleType, label: 'Maintenance', icon: <Wrench size={20} /> },
    { id: 'events' as ModuleType, label: 'Events', icon: <Star size={20} /> },
    { id: 'meetings' as ModuleType, label: 'Meetings', icon: <Building size={20} /> },
    { id: 'loyalty' as ModuleType, label: 'Loyalty', icon: <Award size={20} /> },
    { id: 'wallet' as ModuleType, label: 'Wallet', icon: <CreditCard size={20} /> },
    { id: 'billing' as ModuleType, label: 'Billing', icon: <Receipt size={20} /> },
    { id: 'messaging' as ModuleType, label: 'Messages', icon: <MessageSquare size={20} /> },
    { id: 'notifications' as ModuleType, label: 'Notifications', icon: <Bell size={20} /> },
    { id: 'feedback' as ModuleType, label: 'Feedback', icon: <Star size={20} /> },
    { id: 'help' as ModuleType, label: 'Help', icon: <HelpCircle size={20} /> },
    { id: 'settings' as ModuleType, label: 'Settings', icon: <Settings size={20} /> }
  ].filter(item => moduleOn(item.id));

  const activeNavItem = navigationItems.find((item) => item.id === activeModule);

  // Pinned tabs for the mobile bottom bar — the rest live behind "More".
  const bottomNavItems = [
    { id: 'dashboard' as ModuleType, label: 'Home', icon: <Home size={22} /> },
    { id: 'myStay' as ModuleType, label: 'My Stay', icon: <Bed size={22} /> },
    { id: 'roomService' as ModuleType, label: 'Dining', icon: <UtensilsCrossed size={22} /> },
    { id: 'messaging' as ModuleType, label: 'Messages', icon: <MessageSquare size={22} /> }
  ].filter(item => moduleOn(item.id));
  const isPinnedTab = bottomNavItems.some((item) => item.id === activeModule);

  const renderModule = () => {
    const commonProps = { reservationId, guestId };

    switch (activeModule) {
      case 'dashboard':
        return <HomeDashboardModule {...commonProps} onViewModule={setActiveModule} />;
      case 'profile':
        return <ProfilePreferencesModule {...commonProps} />;
      case 'reservations':
        return <ReservationsModule {...commonProps} />;
      case 'checkin':
        return <DigitalCheckinModule {...commonProps} />;
      case 'digitalKey':
        return <DigitalRoomKeyModule {...commonProps} />;
      case 'myStay':
        return <MyStayModule {...commonProps} />;
      case 'roomService':
        return <RoomServiceModule {...commonProps} />;
      case 'restaurant':
        return <RestaurantReservationsModule {...commonProps} />;
      case 'spa':
        return <SpaWellnessModule {...commonProps} />;
      case 'concierge':
        return <ConciergeServicesModule {...commonProps} />;
      case 'transportation':
        return <TransportationModule {...commonProps} />;
      case 'housekeeping':
        return <HousekeepingRequestsModule {...commonProps} />;
      case 'maintenance':
        return <MaintenanceRequestsModule {...commonProps} />;
      case 'events':
        return <EventActivityBookingModule {...commonProps} />;
      case 'meetings':
        return <MeetingBanquetServicesModule {...commonProps} />;
      case 'loyalty':
        return <LoyaltyProgramModule {...commonProps} />;
      case 'wallet':
        return <WalletPaymentsModule {...commonProps} />;
      case 'billing':
        return <BillingFolioModule {...commonProps} />;
      case 'messaging':
        return <MessagingCenterModule {...commonProps} />;
      case 'notifications':
        return <NotificationsModule {...commonProps} />;
      case 'feedback':
        return <FeedbackReviewsModule {...commonProps} />;
      case 'help':
        return <HelpCenterModule {...commonProps} />;
      case 'settings':
        return <SettingsModule {...commonProps} />;
      default:
        return <HomeDashboardModule {...commonProps} onViewModule={setActiveModule} />;
    }
  };

  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Loading guest portal…</p>
      </div>
    );
  }

  if (authState === 'login') {
    return (
      <GuestLoginScreen
        onSuccess={(g) => {
          setSessionGuest(g);
          sessionStorage.setItem('guest_portal_guest_id', g.guestId);
          setAuthState(g.forcePasswordChange ? 'changePassword' : 'ready');
        }}
      />
    );
  }

  if (authState === 'changePassword') {
    return (
      <GuestPasswordChangeScreen
        guestName={sessionGuest?.name}
        onDone={() => setAuthState('ready')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      {/* Mobile Header — sticky, shows the current section */}
      <header className="lg:hidden sticky top-0 z-40 bg-white/95 dark:bg-slate-800/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 pt-[env(safe-area-inset-top)]">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              className="p-2 -ml-2 shrink-0 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">Guest Portal</h1>
              {activeNavItem && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{activeNavItem.label}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setActiveModule('notifications')}
            aria-label="Notifications"
            className={`p-2 shrink-0 rounded-lg ${
              activeModule === 'notifications'
                ? 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <Bell size={20} />
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar Navigation — drawer on mobile, sticky sidebar on desktop */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] lg:w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:sticky lg:inset-auto lg:top-0 lg:h-screen flex flex-col ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-2 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Guest Portal</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">SELEDA Grand Hotel</p>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
              className="lg:hidden p-2 -mr-2 -mt-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            >
              <X size={22} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:pb-4">
            <ul className="space-y-1">
              {navigationItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                      activeModule === item.id
                        ? 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Main Content Area — bottom padding clears the mobile tab bar */}
        <main className="flex-1 min-w-0 lg:ml-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <div className="min-h-screen">
            {renderModule()}
          </div>
        </main>
      </div>

      {/* Bottom tab bar — primary sections on phones, "More" opens the drawer */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-800/95 backdrop-blur border-t border-slate-200 dark:border-slate-700 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {bottomNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium whitespace-nowrap transition ${
                activeModule === item.id
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium whitespace-nowrap transition ${
              mobileMenuOpen || !isPinnedTab
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Menu size={22} />
            More
          </button>
        </div>
      </nav>
    </div>
  );
};

const GuestPortalUnavailable: React.FC = () => (
  <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-6">
    <div className="text-center max-w-md">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Guest Portal</h1>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        The guest portal is currently unavailable. Please contact the front desk for assistance.
      </p>
    </div>
  </div>
);

export default GuestPortal;
