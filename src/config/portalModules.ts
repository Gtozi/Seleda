/**
 * Module registries for the two public-facing portals.
 *
 * Portal Management (/erp/admin/portal_management) renders these as expandable
 * rows under the "Public Portal" and "Guest Portal" entries. Per-module
 * visibility is stored in global_settings.module_toggles under the keys
 * `public_<id>` / `guest_<id>` — the same mechanism department tabs use.
 *
 * Enforcement:
 *  - PublicPortal reads moduleToggles + guestPortalEnabled via /api/public/settings.
 *  - GuestPortal reads the same payload.
 *  - `public_booking_enabled` / `guest_portal_enabled` columns gate the booking
 *    engine server-side and the guest portal client-side respectively.
 */

export interface PortalModuleDef {
  id: string;
  label: string;
}

export const PUBLIC_PORTAL_MODULES: PortalModuleDef[] = [
  { id: 'home', label: 'Home' },
  { id: 'booking', label: 'Book Rooms' },
  { id: 'properties', label: 'Properties' },
  { id: 'packages', label: 'Packages' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'weddings', label: 'Weddings' },
  { id: 'restaurant', label: 'Dining' },
  { id: 'spa', label: 'Spa' },
  { id: 'experiences', label: 'Experiences' },
  { id: 'transportation', label: 'Transport' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'offers', label: 'Offers' },
  { id: 'contact', label: 'Contact us' },
  { id: 'support', label: 'Help & FAQs' },
];

export const GUEST_PORTAL_MODULES: PortalModuleDef[] = [
  { id: 'dashboard', label: 'Home' },
  { id: 'profile', label: 'Profile' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'checkin', label: 'Check-in' },
  { id: 'digitalKey', label: 'Digital Key' },
  { id: 'myStay', label: 'My Stay' },
  { id: 'roomService', label: 'Room Service' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'spa', label: 'Spa & Wellness' },
  { id: 'concierge', label: 'Concierge' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'events', label: 'Events' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'billing', label: 'Billing' },
  { id: 'messaging', label: 'Messages' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'help', label: 'Help' },
  { id: 'settings', label: 'Settings' },
];

/** moduleToggles key for a portal module — mirrors `<dept>_<tabId>`. */
export const publicModuleKey = (id: string) => `public_${id}`;
export const guestModuleKey = (id: string) => `guest_${id}`;

/** A module is visible unless its toggle is explicitly false. */
export const portalModuleOn = (
  toggles: Record<string, boolean> | undefined | null,
  key: string
) => !toggles || toggles[key] !== false;
