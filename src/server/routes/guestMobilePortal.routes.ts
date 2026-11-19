import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getNotificationTemplate, renderTemplate } from '../services/adminConfigService';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  getRequestUser,
  parseCookies,
  SESSION_COOKIE,
  hashToken,
  setRawSessionCookie,
  clearSessionCookie,
  createSessionToken,
  fetchSessionSettings,
  revokeRequestSession,
  fetchPasswordPolicy,
} from '../services/sessionService';
import { validatePassword } from '../../lib/passwordPolicy';
import { rateLimit } from '../middleware/rateLimit';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import { cacheService } from '../services/cacheService';
import {
  SpaError,
  applyCancellationFee,
  canActForGuest,
  checkBookingResources,
  findAppointmentConflicts,
  flagWaitlistForFreedSlot,
  guestPropertyId,
  guestWellnessWarnings,
  nextSpaId,
  providerDayStatus,
  recordAppointmentHistory,
  recordContraindicationAlert,
  timeToMin,
} from '../services/spaService';
import { runTransportStatusSideEffects } from '../services/transportLifecycle';
import {
  conciergeRequestDefaults,
  getConciergeSettings,
  wakeupWindowError,
} from '../services/conciergeSettings';
import { canAccommodateBookings } from '../services/fbTableAllocation';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

// ── Guest authentication ─────────────────────────────────────────────────
// Guests have no system_users account, so the session cookie is not the only
// credential: the booking link itself is the bearer credential (the same
// model canActForGuest already enforces). A request authenticates when it
// carries a reservationId (path/body/query) for a reservation in an
// accessible status; if a guestId is also supplied it must own the
// reservation. Staff sessions keep working unchanged via getRequestUser.
const GUEST_BEARER_STATUSES = new Set([
  'Reserved', 'Confirmed', 'Pending', 'Guaranteed',
  'CheckedIn', 'Checked In', 'InHouse', 'In House',
]);

/**
 * Resolve a guest portal session (migration 655 guest_sessions). Guests are
 * not system_users, so their sessions live in a separate table keyed to
 * guests.id — same sliding idle-timeout semantics as user_sessions.
 */
async function resolveGuestSession(req: any) {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return null;
  const token = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const { data: session } = await supabaseAdmin
    .from('guest_sessions')
    .select('id, guest_id, expires_at, revoked_at, last_activity')
    .eq('token_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle();
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;

  const { timeoutMs } = await fetchSessionSettings();
  if (session.last_activity && Date.now() - new Date(session.last_activity).getTime() > timeoutMs) {
    await supabaseAdmin.from('guest_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', session.id);
    return null;
  }
  await supabaseAdmin.from('guest_sessions')
    .update({ last_activity: new Date().toISOString() })
    .eq('id', session.id);

  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name, email, force_password_change')
    .eq('id', session.guest_id)
    .maybeSingle();
  if (!guest) return null;
  return { sessionId: session.id, guest };
}

function guestSessionUser(guest: any) {
  return {
    id: guest.id,
    name: guest.name,
    email: guest.email || '',
    role: 'guest',
    roleDescription: 'Guest',
    avatarInitials: String(guest.name || 'G').slice(0, 2).toUpperCase(),
    status: 'Active',
  } as any;
}

async function authenticateGuestOrStaff(req: any, res: any, next: any) {
  try {
    if (req.user) return next();
    const user = await getRequestUser(req);
    if (user) {
      req.user = user;
      return next();
    }

    // Logged-in guest (guest_sessions). A guest who has not yet completed the
    // forced first-login password change may only reach /auth/* endpoints.
    const guestSession = await resolveGuestSession(req);
    if (guestSession) {
      req.user = guestSessionUser(guestSession.guest);
      req.guestSession = guestSession;
      if (guestSession.guest.force_password_change && !req.path.startsWith('/auth/')) {
        return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      return next();
    }

    if (!hasSupabaseAdminConfig || !supabaseAdmin) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const reservationId =
      req.params?.reservationId || req.params?.id ||
      req.body?.reservationId || req.body?.reservation_id ||
      req.query?.reservationId || req.query?.reservation_id;
    const guestId =
      req.params?.guestId || req.body?.guestId || req.body?.guest_id ||
      req.query?.guestId || req.query?.guest_id;
    if (typeof reservationId !== 'string' || !reservationId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { data: resv } = await supabaseAdmin
      .from('reservations')
      .select('guest_id, status')
      .eq('id', reservationId)
      .maybeSingle();
    if (!resv || !GUEST_BEARER_STATUSES.has(String(resv.status))) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (typeof guestId === 'string' && guestId && resv.guest_id !== guestId) {
      return res.status(403).json({ error: 'Reservation does not belong to this guest' });
    }
    req.guestPrincipal = { guestId: resv.guest_id, reservationId };
    return next();
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }
}

// ── Guest authentication ─────────────────────────────────────────────────
// Username is the guest's full name (case-insensitive). The bootstrap
// password is the guest's own id — first login hashes it and sets
// force_password_change so a real password must be chosen before the portal
// can be used (enforced in authenticateGuestOrStaff above).

const guestLoginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

router.post('/auth/login', guestLoginLimiter, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const name = String(req.body?.name || req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required' });
  }

  // Several guests may share a name — the password disambiguates.
  const { data: candidates, error } = await supabaseAdmin
    .from('guests')
    .select('id, name, email, password_hash, force_password_change')
    .ilike('name', name)
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });

  let guest: any = null;
  let bootstrap = false;
  for (const c of candidates || []) {
    if (c.password_hash) {
      if (await bcrypt.compare(password, c.password_hash)) { guest = c; break; }
    } else if (password === c.id) {
      guest = c;
      bootstrap = true;
      break;
    }
  }
  if (!guest) return res.status(401).json({ error: 'Invalid name or password' });

  if (bootstrap) {
    await supabaseAdmin.from('guests').update({
      password_hash: await bcrypt.hash(password, 10),
      password_updated_at: new Date().toISOString(),
      force_password_change: true,
    }).eq('id', guest.id);
    guest.force_password_change = true;
  }
  await supabaseAdmin.from('guests')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', guest.id);

  // Same session cookie name; guest_sessions is the store (guests have no
  // system_users row for user_sessions to reference).
  const token = createSessionToken();
  const { timeoutMs, maxConcurrent } = await fetchSessionSettings();
  const { data: active } = await supabaseAdmin
    .from('guest_sessions')
    .select('id, created_at')
    .eq('guest_id', guest.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: true });
  if (active && active.length >= maxConcurrent) {
    for (const s of active.slice(0, active.length - maxConcurrent + 1)) {
      await supabaseAdmin.from('guest_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', s.id);
    }
  }
  await supabaseAdmin.from('guest_sessions').insert({
    guest_id: guest.id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + timeoutMs).toISOString(),
    last_activity: new Date().toISOString(),
    user_agent: req.headers['user-agent'] || null,
    ip_address: req.ip || null,
  });
  setRawSessionCookie(res, token);

  return res.json({
    success: true,
    guestId: guest.id,
    name: guest.name,
    forcePasswordChange: !!guest.force_password_change,
  });
});

// Session bootstrap for the portal shell: tells the frontend who is logged
// in (guest session or staff session) and whether a password change is due.
router.get('/auth/session', async (req, res) => {
  const user = await getRequestUser(req);
  if (user) return res.json({ type: 'staff', user });
  const guestSession = await resolveGuestSession(req);
  if (guestSession) {
    return res.json({
      type: 'guest',
      guestId: guestSession.guest.id,
      name: guestSession.guest.name,
      forcePasswordChange: !!guestSession.guest.force_password_change,
    });
  }
  return res.status(401).json({ error: 'Not authenticated' });
});

// Change password — works for guest sessions (guests table) and, for
// convenience when staff browse the portal, staff sessions (system_users).
router.post('/auth/change-password', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });
  const policy = await fetchPasswordPolicy();
  const validation = validatePassword(newPassword, policy);
  if (!validation.valid) return res.status(400).json({ error: validation.errors.join('; ') });

  const newHash = await bcrypt.hash(newPassword, 10);

  if (req.user?.role === 'guest') {
    const { data: guest } = await supabaseAdmin
      .from('guests')
      .select('id, password_hash, force_password_change')
      .eq('id', req.user.id)
      .maybeSingle();
    if (!guest) return res.status(404).json({ error: 'Guest not found' });
    if (!guest.force_password_change) {
      if (!currentPassword) return res.status(400).json({ error: 'currentPassword is required' });
      const ok = await bcrypt.compare(String(currentPassword), guest.password_hash || '');
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const { error } = await supabaseAdmin.from('guests').update({
      password_hash: newHash,
      password_updated_at: new Date().toISOString(),
      force_password_change: false,
    }).eq('id', guest.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // Staff session — same semantics as /api/auth/change-password.
  const { data: dbUser } = await supabaseAdmin
    .from('system_users')
    .select('password_hash, force_password_change')
    .eq('id', req.user!.id)
    .maybeSingle();
  if (!dbUser?.password_hash) return res.status(500).json({ error: 'User record incomplete' });
  if (!dbUser.force_password_change) {
    if (!currentPassword) return res.status(400).json({ error: 'currentPassword is required' });
    const ok = await bcrypt.compare(String(currentPassword), dbUser.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const { error } = await supabaseAdmin.from('system_users').update({
    password_hash: newHash,
    password_updated_at: new Date().toISOString(),
    force_password_change: false,
  }).eq('id', req.user!.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Logout — revokes whichever session type is present and clears the cookie.
router.post('/auth/logout', async (req, res) => {
  if (hasSupabaseAdminConfig && supabaseAdmin) {
    const token = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
    if (token) {
      await supabaseAdmin.from('guest_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', hashToken(token));
    }
  }
  await revokeRequestSession(req);
  clearSessionCookie(res);
  return res.json({ success: true });
});

// ── Help Center ────────────────────────────────────────────────────────────
// Composed help payload: the guest's property (real contact info + check-in/out
// times + optional emergency contacts in metadata) plus active FAQs from
// guest_faqs (global rows + rows scoped to the guest's property).
router.get('/help/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view help for this guest' });
  }

  const propId = await guestPropertyId(req.params.guestId);

  const [{ data: property }, { data: faqs, error: faqError }] = await Promise.all([
    propId
      ? supabaseAdmin
          .from('properties')
          .select('id, property_name, contact_phone, contact_email, address, star_rating, metadata')
          .eq('id', propId)
          .maybeSingle()
      : Promise.resolve({ data: null } as any),
    supabaseAdmin
      .from('guest_faqs')
      .select('id, category, question, answer, sort_order')
      .eq('is_active', true)
      .or(propId ? `property_id.is.null,property_id.eq.${propId}` : 'property_id.is.null')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(200),
  ]);

  if (faqError) return res.status(500).json({ error: faqError.message });

  const meta = (property as any)?.metadata || {};
  return res.json({
    property: property
      ? {
          name: (property as any).property_name,
          phone: (property as any).contact_phone || null,
          email: (property as any).contact_email || null,
          address: (property as any).address || null,
          starRating: (property as any).star_rating || null,
          checkInTime: meta.check_in_time || '3:00 PM',
          checkOutTime: meta.check_out_time || '11:00 AM',
          emergencyContacts: meta.emergency_contacts || null,
        }
      : null,
    faqs: faqs || [],
  });
});

// ── Phase 2: Mobile Check-In Flow ────────────────────────────────────────────
// Initiate mobile check-in
// Get the check-in state for a reservation (drives resume + prefill)
router.get('/check-in/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: reservation, error: resError } = await supabaseAdmin
    .from('reservations')
    .select('id, property_id, guest_id, guest_name, guest_email, guest_phone, check_in_date, check_out_date, room_type, room_number, adults, children, status, payment_status, total_amount, rate, custom_hotel_name')
    .eq('id', req.params.reservationId)
    .maybeSingle();
  if (resError) return res.status(500).json({ error: resError.message });
  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

  // The path reservationId is the bearer credential on guest surfaces —
  // feed it to canActForGuest, which only inspects body/query.
  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (reservation.guest_id && !(await canActForGuest(authReq, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view this check-in' });
  }

  const { data: checkIn, error: ciError } = await supabaseAdmin
    .from('mobile_check_ins')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ciError) return res.status(500).json({ error: ciError.message });

  let guest: any = null;
  if (reservation.guest_id) {
    const { data: g } = await supabaseAdmin
      .from('guests')
      .select('id, name, first_name, last_name, email, phone, nationality')
      .eq('id', reservation.guest_id)
      .maybeSingle();
    guest = g;
  }

  let propertyName: string | null = reservation.custom_hotel_name || null;
  if (!propertyName && reservation.property_id) {
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('property_name')
      .eq('id', reservation.property_id)
      .maybeSingle();
    propertyName = prop?.property_name || null;
  }

  return res.json({
    checkIn,
    reservation: {
      id: reservation.id,
      propertyId: reservation.property_id,
      guestId: reservation.guest_id,
      guestName: reservation.guest_name,
      checkInDate: reservation.check_in_date,
      checkOutDate: reservation.check_out_date,
      roomType: reservation.room_type,
      roomNumber: reservation.room_number,
      guests: Math.max(1, (reservation.adults || 0) + (reservation.children || 0)),
      status: reservation.status,
      paymentStatus: reservation.payment_status || 'Unpaid',
      totalAmount: Number(reservation.total_amount || 0),
      rate: Number(reservation.rate || 0),
      hotelName: propertyName || 'SELEDA Grand Hotel',
    },
    guest,
  });
});

// Initiate mobile check-in — idempotent per reservation
router.post('/check-in/initiate', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const {
    reservationId,
    propertyId,
    guestId,
  } = req.body || {};
  
  if (!reservationId || !guestId) {
    return res.status(400).json({ error: 'reservationId and guestId are required' });
  }

  const { data: reservation } = await supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('id', reservationId)
    .single();

  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

  if (reservation.guest_id && reservation.guest_id !== guestId) {
    return res.status(400).json({ error: 'Reservation does not belong to this guest' });
  }
  if (!(await canActForGuest(req, guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (!['Reserved', 'Pending', 'Confirmed', 'CheckedIn'].includes(String(reservation.status))) {
    return res.status(409).json({ error: `A ${reservation.status} reservation is not eligible for check-in` });
  }

  // Resume an existing check-in rather than creating a duplicate
  const { data: existing } = await supabaseAdmin
    .from('mobile_check_ins')
    .select('*')
    .eq('reservation_id', reservationId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return res.json({ checkIn: existing, reservation });

  const { data, error } = await supabaseAdmin.from('mobile_check_ins').insert({
    reservation_id: reservationId,
    property_id: propertyId || reservation.property_id,
    guest_id: guestId,
    status: 'initiated',
    initiated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.status(201).json({ checkIn: data, reservation });
});

// Save wizard progress (step completion, arrival time, room preferences)
router.patch('/check-in/:checkInId/progress', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('mobile_check_ins')
    .select('*')
    .eq('id', req.params.checkInId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Check-in not found' });
  if (existing.status === 'completed') {
    return res.status(409).json({ error: 'Check-in is already completed' });
  }

  const { reservationId } = req.body || {};
  if (reservationId && reservationId !== existing.reservation_id) {
    return res.status(400).json({ error: 'reservationId does not match this check-in' });
  }
  if (!(await canActForGuest(req, existing.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  const {
    progress,
    estimatedArrival,
    roomPreferences,
    photoIdVerified,
    paymentMethodOnFile,
  } = req.body || {};

  const update: Record<string, unknown> = {
    status: 'in_progress',
  };
  if (progress && typeof progress === 'object') {
    update.progress = { ...(existing.progress || {}), ...progress };
  }
  if (estimatedArrival !== undefined) update.estimated_arrival = estimatedArrival;
  if (roomPreferences !== undefined) update.room_preferences = roomPreferences;
  if (photoIdVerified !== undefined) update.photo_id_verified = !!photoIdVerified;
  if (paymentMethodOnFile !== undefined) update.payment_method_on_file = !!paymentMethodOnFile;

  const { data, error } = await supabaseAdmin
    .from('mobile_check_ins')
    .update(update)
    .eq('id', req.params.checkInId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ checkIn: data });
});

// Complete mobile check-in
router.post('/check-in/:checkInId/complete', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const {
    reservationId,
    signature,
    photoIdVerified,
    paymentMethodOnFile,
    completedBy,
  } = req.body || {};

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('mobile_check_ins')
    .select('*')
    .eq('id', req.params.checkInId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Check-in not found' });
  if (reservationId && reservationId !== existing.reservation_id) {
    return res.status(400).json({ error: 'reservationId does not match this check-in' });
  }
  if (!(await canActForGuest(req, existing.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (existing.status === 'completed') {
    return res.json(existing);
  }

  const { data, error } = await supabaseAdmin
    .from('mobile_check_ins')
    .update({
      status: 'completed',
      signature,
      photo_id_verified: photoIdVerified ?? existing.photo_id_verified,
      payment_method_on_file: paymentMethodOnFile ?? existing.payment_method_on_file,
      completed_by: completedBy || req.user?.id,
      completed_at: new Date().toISOString(),
    })
    .eq('id', req.params.checkInId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Staff have no reader for mobile_check_ins — file a Front Office queue
  // entry so the desk knows to verify ID, assign the room, and finalize.
  try {
    const { data: resv } = await supabaseAdmin
      .from('reservations')
      .select('guest_name, room_number, check_in_date')
      .eq('id', existing.reservation_id)
      .maybeSingle();
    await supabaseAdmin.from('guest_requests').insert({
      request_number: `CKI-${Date.now().toString(36).toUpperCase()}`,
      property_id: existing.property_id,
      reservation_id: existing.reservation_id,
      guest_id: existing.guest_id,
      guest_name: resv?.guest_name || 'Guest',
      room_number: resv?.room_number || null,
      request_type: 'Digital Check-in',
      description: 'Guest completed mobile check-in — identity verified and signature captured. Review documents, assign/confirm room, and finalize check-in at the desk.',
      priority: 'Normal',
      status: 'Open',
      assigned_department: 'Front Office',
      submitted_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('check-in FO handoff failed:', e?.message);
  }

  await emitGuestNotification({
    guestId: existing.guest_id,
    reservationId: existing.reservation_id,
    propertyId: existing.property_id,
    category: 'checkin',
    title: 'Check-in submitted',
    message: 'Your digital check-in is complete. The front desk will verify your documents and finalize your arrival.',
  });

  cacheService.invalidate('guest-*');
  return res.json(data);
});

// ── Digital Room Key ────────────────────────────────────────────────────────
// Real key lifecycle over `digital_keys` (migration 651). Lock-system
// credential provisioning is still pending a provider — the rows track
// issuance, sharing, expiry, and revocation.
function mapDigitalKey(k: any) {
  return {
    id: k.id,
    reservationId: k.reservation_id,
    kind: k.kind || 'device',
    deviceName: k.device_name,
    deviceType: k.device_type,
    sharedWithName: k.shared_with_name,
    sharedRelationship: k.shared_relationship,
    status: k.status || 'active',
    issuedAt: k.issued_at,
    expiresAt: k.expiry_date,
    revokedAt: k.revoked_at,
  };
}

async function fetchKeyReservation(res: any, reservationId: string) {
  const { data: reservation, error } = await supabaseAdmin!
    .from('reservations')
    .select('id, property_id, guest_id, guest_name, room_number, status, check_in_date, check_out_date')
    .eq('id', reservationId)
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!reservation) { res.status(404).json({ error: 'Reservation not found' }); return null; }
  return reservation;
}

// Lazily expire active keys past their expiry_date
async function expireDigitalKeys(reservationId: string) {
  await supabaseAdmin!
    .from('digital_keys')
    .update({ status: 'expired' })
    .eq('reservation_id', reservationId)
    .eq('status', 'active')
    .lt('expiry_date', new Date().toISOString());
}

// List keys + reservation context for a reservation
router.get('/digital-key/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const reservation = await fetchKeyReservation(res, req.params.reservationId);
  if (!reservation) return;

  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (reservation.guest_id && !(await canActForGuest(authReq, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view these keys' });
  }

  await expireDigitalKeys(req.params.reservationId);

  const { data: keys, error } = await supabaseAdmin
    .from('digital_keys')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    reservationId: req.params.reservationId,
    keys: (keys || []).map(mapDigitalKey),
    reservation: {
      id: reservation.id,
      propertyId: reservation.property_id,
      guestId: reservation.guest_id,
      guestName: reservation.guest_name,
      roomNumber: reservation.room_number,
      status: reservation.status,
      checkInDate: reservation.check_in_date,
      checkOutDate: reservation.check_out_date,
    },
  });
});

// Issue a device key for the reservation's room
router.post('/digital-key/:reservationId/issue', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  const { deviceName, deviceType, guestId } = req.body || {};
  if (!deviceName) return res.status(400).json({ error: 'deviceName is required' });

  const reservation = await fetchKeyReservation(res, req.params.reservationId);
  if (!reservation) return;

  const keyGuestId = guestId || reservation.guest_id;
  if (keyGuestId && !(await canActForGuest(req, keyGuestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (!reservation.room_number) {
    return res.status(409).json({ error: 'No room assigned to this reservation yet — a key can be issued after check-in' });
  }
  if (!['CheckedIn', 'Checked In', 'InHouse', 'In House'].includes(String(reservation.status))) {
    return res.status(409).json({ error: `A ${reservation.status} reservation cannot hold a room key` });
  }

  const expiry = reservation.check_out_date
    ? `${String(reservation.check_out_date).slice(0, 10)}T11:00:00.000Z`
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin.from('digital_keys').insert({
    reservation_id: req.params.reservationId,
    property_id: reservation.property_id,
    guest_id: keyGuestId,
    room_id: reservation.room_number,
    kind: 'device',
    device_name: String(deviceName).slice(0, 120),
    device_type: ['iOS', 'Android'].includes(deviceType) ? deviceType : null,
    status: 'active',
    issued_at: new Date().toISOString(),
    expiry_date: expiry,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await emitGuestNotification({
    guestId: keyGuestId,
    reservationId: req.params.reservationId,
    propertyId: reservation.property_id,
    category: 'checkin',
    title: 'Digital key issued',
    message: `A digital key for room ${reservation.room_number} is now active on this device until ${String(expiry).slice(0, 10)}.`,
  });

  cacheService.invalidate('guest-*');
  return res.status(201).json({ key: mapDigitalKey(data) });
});

// Share access with a companion
router.post('/digital-key/:reservationId/share', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { guestId, guestName, relationship } = req.body || {};
  if (!guestName) return res.status(400).json({ error: 'guestName is required' });

  const reservation = await fetchKeyReservation(res, req.params.reservationId);
  if (!reservation) return;

  const keyGuestId = guestId || reservation.guest_id;
  if (keyGuestId && !(await canActForGuest(req, keyGuestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (!reservation.room_number) {
    return res.status(409).json({ error: 'No room assigned to this reservation yet' });
  }

  const expiry = reservation.check_out_date
    ? `${String(reservation.check_out_date).slice(0, 10)}T11:00:00.000Z`
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin.from('digital_keys').insert({
    reservation_id: req.params.reservationId,
    property_id: reservation.property_id,
    guest_id: keyGuestId,
    room_id: reservation.room_number,
    kind: 'shared',
    shared_with_name: String(guestName).slice(0, 120),
    shared_relationship: String(relationship || '').slice(0, 60) || null,
    status: 'active',
    issued_at: new Date().toISOString(),
    expiry_date: expiry,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.status(201).json({ key: mapDigitalKey(data) });
});

// Revoke a single key
router.patch('/digital-key/:keyId/revoke', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('digital_keys')
    .select('*')
    .eq('id', req.params.keyId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Key not found' });

  const { reservationId } = req.body || {};
  if (reservationId && reservationId !== existing.reservation_id) {
    return res.status(400).json({ error: 'reservationId does not match this key' });
  }
  if (existing.guest_id && !(await canActForGuest(req, existing.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (existing.status === 'revoked') {
    return res.json({ key: mapDigitalKey(existing) });
  }

  const { data, error } = await supabaseAdmin
    .from('digital_keys')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', req.params.keyId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ key: mapDigitalKey(data) });
});

// Lost device — revoke every active key on the reservation
router.post('/digital-key/:reservationId/revoke-all', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const reservation = await fetchKeyReservation(res, req.params.reservationId);
  if (!reservation) return;

  if (reservation.guest_id && !(await canActForGuest(req, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  const { error } = await supabaseAdmin
    .from('digital_keys')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('reservation_id', req.params.reservationId)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ ok: true, reservationId: req.params.reservationId });
});

// ── Guest Room Service ──────────────────────────────────────────────────────
// Guest-facing room service backed by the real F&B tables
// (fb_room_service_menu_items + menu_items, fb_room_service_orders +
// fb_room_service_order_items). The staff console manages the same rows via
// /api/fb-portal/room-service-*.
const DAY_KEYS_RS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function roomServiceAvailableNow(item: any, now: Date): boolean {
  if (item.is_available_24h) return true;
  const days: string[] = item.availability_days || [];
  if (days.length && !days.includes(DAY_KEYS_RS[now.getDay()])) return false;
  if (!item.available_from || !item.available_until) return true;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= String(item.available_from).slice(0, 5) && hhmm <= String(item.available_until).slice(0, 5);
}

async function fetchRoomServiceReservation(res: any, reservationId: string) {
  const { data: reservation, error } = await supabaseAdmin!
    .from('reservations')
    .select('id, property_id, guest_id, guest_name, room_number, status')
    .eq('id', reservationId)
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!reservation) { res.status(404).json({ error: 'Reservation not found' }); return null; }
  return reservation;
}

// Menu for the reservation's property — fb_room_service_menu_items joined to
// menu_items, flagged with availability for the current time.
router.get('/room-service/menu/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const reservation = await fetchRoomServiceReservation(res, req.params.reservationId);
  if (!reservation) return;

  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (reservation.guest_id && !(await canActForGuest(authReq, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view this menu' });
  }

  const { data: links, error } = await supabaseAdmin
    .from('fb_room_service_menu_items')
    .select('id, menu_item_id, outlet_id, is_available_24h, available_from, available_until, availability_days')
    .eq('is_active', true);
  if (error) return res.status(500).json({ error: error.message });

  const menuItemIds = [...new Set((links || []).map(l => l.menu_item_id).filter(Boolean))];
  const menuItemMap = new Map<string, any>();
  if (menuItemIds.length) {
    const { data: items } = await supabaseAdmin
      .from('menu_items')
      .select('id, name, description, category, selling_price, preparation_time_minutes, images, allergen_info, nutritional_info, is_active, property_id')
      .in('id', menuItemIds)
      .eq('is_active', true);
    for (const mi of items || []) menuItemMap.set(mi.id, mi);
  }

  const now = new Date();
  const menu = (links || [])
    .map(link => {
      const mi = menuItemMap.get(link.menu_item_id);
      if (!mi) return null;
      if (reservation.property_id && mi.property_id && String(mi.property_id) !== String(reservation.property_id)) return null;
      const allergens: string[] = mi.allergen_info || [];
      const nutrition = (mi.nutritional_info || {}) as Record<string, unknown>;
      const dietary: string[] = Array.isArray(nutrition.dietary) ? nutrition.dietary as string[] : [];
      if (!allergens.some(a => /gluten|wheat/i.test(a))) dietary.push('Gluten-Free');
      return {
        id: link.id,
        menuItemId: link.menu_item_id,
        name: mi.name,
        description: mi.description || '',
        price: Number(mi.selling_price || 0),
        category: mi.category || 'Other',
        preparationTime: mi.preparation_time_minutes || 20,
        image: Array.isArray(mi.images) && mi.images.length ? mi.images[0] : null,
        allergens,
        dietary,
        availableNow: roomServiceAvailableNow(link, now),
        availableFrom: link.is_available_24h ? null : link.available_from,
        availableUntil: link.is_available_24h ? null : link.available_until,
      };
    })
    .filter(Boolean);

  return res.json({
    reservation: {
      id: reservation.id,
      guestId: reservation.guest_id,
      guestName: reservation.guest_name,
      roomNumber: reservation.room_number,
      propertyId: reservation.property_id,
      status: reservation.status,
    },
    menu,
  });
});

// List the reservation's room-service orders with their line items
router.get('/room-service/orders/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const reservation = await fetchRoomServiceReservation(res, req.params.reservationId);
  if (!reservation) return;

  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (reservation.guest_id && !(await canActForGuest(authReq, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view these orders' });
  }

  const { data: orders, error } = await supabaseAdmin
    .from('fb_room_service_orders')
    .select('*')
    .eq('reservation_id', req.params.reservationId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const orderIds = (orders || []).map(o => o.id);
  const itemsByOrder = new Map<string, any[]>();
  if (orderIds.length) {
    const { data: items } = await supabaseAdmin
      .from('fb_room_service_order_items')
      .select('id, room_service_order_id, menu_item_id, quantity, unit_price, total_price, special_instructions')
      .in('room_service_order_id', orderIds);
    const itemNames = new Map<string, string>();
    const miIds = [...new Set((items || []).map(i => i.menu_item_id).filter(Boolean))];
    if (miIds.length) {
      const { data: mis } = await supabaseAdmin.from('menu_items').select('id, name').in('id', miIds);
      for (const mi of mis || []) itemNames.set(mi.id, mi.name);
    }
    for (const item of items || []) {
      const list = itemsByOrder.get(item.room_service_order_id) || [];
      list.push({
        id: item.id,
        name: itemNames.get(item.menu_item_id) || 'Item',
        quantity: item.quantity,
        unitPrice: Number(item.unit_price || 0),
        totalPrice: Number(item.total_price || 0),
        specialInstructions: item.special_instructions,
      });
      itemsByOrder.set(item.room_service_order_id, list);
    }
  }

  return res.json({
    orders: (orders || []).map(o => ({
      id: o.id,
      orderNumber: o.order_id,
      roomNumber: o.room_number,
      status: o.status || 'Pending',
      orderType: o.order_type || 'Immediate',
      scheduledFor: o.scheduled_for,
      totalAmount: Number(o.total_amount || 0),
      specialInstructions: o.special_instructions,
      chargeToRoom: !!o.charge_to_room,
      createdAt: o.created_at,
      items: itemsByOrder.get(o.id) || [],
    })),
  });
});

// Place a room-service order — prices recomputed server-side from menu_items
router.post('/room-service/orders', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    reservationId,
    items,
    scheduledFor,
    specialInstructions,
    chargeToRoom,
  } = req.body || {};

  if (!reservationId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'reservationId and items[] are required' });
  }

  const reservation = await fetchRoomServiceReservation(res, reservationId);
  if (!reservation) return;

  if (reservation.guest_id && !(await canActForGuest(req, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (!reservation.room_number) {
    return res.status(409).json({ error: 'No room assigned to this reservation — room service is available once you are checked in' });
  }
  if (String(reservation.status) === 'Cancelled' || String(reservation.status) === 'CheckedOut') {
    return res.status(409).json({ error: `A ${reservation.status} reservation cannot place room-service orders` });
  }

  // Validate items against the room-service menu and recompute prices
  const { data: links } = await supabaseAdmin
    .from('fb_room_service_menu_items')
    .select('id, menu_item_id')
    .eq('is_active', true);
  const linkByMenuItem = new Map((links || []).map(l => [l.menu_item_id, l]));

  const normalized: { menuItemId: string; quantity: number; specialInstructions?: string }[] = [];
  for (const raw of items) {
    const menuItemId = String(raw?.menuItemId || '');
    const quantity = Math.max(1, Math.min(20, Number(raw?.quantity) || 1));
    if (!linkByMenuItem.has(menuItemId)) {
      return res.status(400).json({ error: `Item ${menuItemId} is not on the room-service menu` });
    }
    normalized.push({ menuItemId, quantity, specialInstructions: raw?.specialInstructions ? String(raw.specialInstructions).slice(0, 500) : undefined });
  }

  const { data: menuRows } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, selling_price')
    .in('id', normalized.map(i => i.menuItemId));
  const priceById = new Map((menuRows || []).map(m => [m.id, Number(m.selling_price || 0)]));

  const totalAmount = normalized.reduce((sum, i) => sum + (priceById.get(i.menuItemId) || 0) * i.quantity, 0);
  const orderType = scheduledFor ? 'Scheduled' : 'Immediate';
  const orderNumber = `RSO-${Date.now().toString(36).toUpperCase()}`;

  const { data: order, error: orderError } = await supabaseAdmin
    .from('fb_room_service_orders')
    .insert({
      order_id: orderNumber,
      room_number: reservation.room_number,
      guest_name: reservation.guest_name,
      guest_id: reservation.guest_id,
      reservation_id: reservationId,
      order_type: orderType,
      scheduled_for: scheduledFor || null,
      total_amount: totalAmount,
      special_instructions: specialInstructions ? String(specialInstructions).slice(0, 1000) : null,
      status: 'Pending',
      charge_to_room: chargeToRoom !== false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (orderError) return res.status(500).json({ error: orderError.message });

  const { error: itemsError } = await supabaseAdmin
    .from('fb_room_service_order_items')
    .insert(normalized.map(i => ({
      room_service_order_id: order.id,
      menu_item_id: i.menuItemId,
      quantity: i.quantity,
      unit_price: priceById.get(i.menuItemId) || 0,
      total_price: (priceById.get(i.menuItemId) || 0) * i.quantity,
      special_instructions: i.specialInstructions || null,
    })));
  if (itemsError) return res.status(500).json({ error: itemsError.message });

  await emitGuestNotification({
    guestId: reservation.guest_id,
    reservationId,
    propertyId: reservation.property_id,
    category: 'order',
    title: 'Room service order received',
    message: `Order ${orderNumber} (${totalAmount.toFixed(2)}) was sent to the kitchen${scheduledFor ? ` for ${new Date(scheduledFor).toLocaleString()}` : ''}.`,
  });

  cacheService.invalidate('guest-*');
  cacheService.invalidate('fb-*');
  return res.status(201).json({ orderId: order.id, orderNumber, totalAmount, status: 'Pending' });
});

// Guest cancels an order while it is still pending
router.patch('/room-service/orders/:orderId/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('fb_room_service_orders')
    .select('id, reservation_id, guest_id, status')
    .eq('id', req.params.orderId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Order not found' });

  if (existing.guest_id && !(await canActForGuest(req, existing.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  if (String(existing.status) !== 'Pending') {
    return res.status(409).json({ error: `An order that is ${existing.status} can no longer be cancelled` });
  }

  const { error } = await supabaseAdmin
    .from('fb_room_service_orders')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.orderId);
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  cacheService.invalidate('fb-*');
  return res.json({ ok: true, id: req.params.orderId, status: 'Cancelled' });
});

// ── Housekeeping Requests ───────────────────────────────────────────────────
// Guest-facing HK requests write into the shared `guest_requests` queue with
// assigned_department='HK' — the same rows the staff Housekeeping Guest
// Requests tab reads via /api/front-office/guest-requests?department=HK.
const HK_REQUEST_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

router.get('/housekeeping/requests/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id')
    .eq('id', req.params.reservationId)
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (resv.guest_id && !(await canActForGuest(authReq, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view these requests' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .select('id, request_number, request_type, description, priority, status, scheduled_for, submitted_at, acknowledged_at, completed_at')
    .eq('reservation_id', req.params.reservationId)
    .eq('assigned_department', 'HK')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// Create housekeeping request — resolves stay details server-side.
router.post('/housekeeping/requests', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { reservationId, requestType, description, priority, scheduled_for } = req.body || {};
  if (!reservationId || !requestType || !description) {
    return res.status(400).json({ error: 'reservationId, requestType and description are required' });
  }

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, guest_name, room_number, property_id, status')
    .eq('id', String(reservationId))
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  if (resv.guest_id && !(await canActForGuest(req, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to request for this reservation' });
  }

  const priorityValue = HK_REQUEST_PRIORITIES.includes(priority) ? priority : 'Normal';
  const scheduledAt = scheduled_for ? new Date(scheduled_for) : null;
  const validSchedule = scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null;
  const requestNumber = `HKR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('guest_requests').insert({
    request_number: requestNumber,
    property_id: resv.property_id || null,
    reservation_id: resv.id,
    room_number: resv.room_number || null,
    guest_name: resv.guest_name || null,
    request_type: String(requestType).slice(0, 100),
    description: String(description).slice(0, 2000),
    priority: priorityValue,
    status: 'Open',
    assigned_department: 'HK',
    scheduled_for: validSchedule ? validSchedule.toISOString() : null,
    submitted_at: new Date().toISOString(),
  }).select('id, request_number, request_type, description, priority, status, submitted_at').single();

  if (error) return res.status(500).json({ error: error.message });

  await emitGuestNotification({
    guestId: resv.guest_id,
    reservationId: resv.id,
    propertyId: resv.property_id,
    category: 'request_update',
    title: 'Housekeeping request received',
    message: `${requestNumber}: ${String(requestType).slice(0, 80)} — housekeeping has been notified.`,
  });

  cacheService.invalidate('guest-*');
  return res.status(201).json({ request: data });
});

// Guests may cancel only their own still-open HK requests.
router.patch('/housekeeping/requests/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('guest_requests')
    .select('id, reservation_id, status')
    .eq('id', req.params.id)
    .eq('assigned_department', 'HK')
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.status !== 'Open') {
    return res.status(400).json({ error: 'Only open requests can be cancelled' });
  }

  if (existing.reservation_id) {
    const { data: resv } = await supabaseAdmin
      .from('reservations')
      .select('guest_id')
      .eq('id', existing.reservation_id)
      .maybeSingle();
    if (resv?.guest_id && !(await canActForGuest(req, resv.guest_id))) {
      return res.status(403).json({ error: 'Not authorized to cancel this request' });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('id, request_number, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('guest-*');
  return res.json({ request: data });
});

// ── Maintenance Requests ────────────────────────────────────────────────────
// Guest-facing maintenance reports write into the shared `guest_requests`
// queue with assigned_department='Engineering' — the seeded request-type map
// routes 'Maintenance' there and staff pick it up from the FO/engineering
// request queues. (The `maintenance_requests` table these routes used to
// write does not exist.)
const MAINT_REQUEST_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

router.get('/maintenance/requests/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id')
    .eq('id', req.params.reservationId)
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (resv.guest_id && !(await canActForGuest(authReq, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view these requests' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .select('id, request_number, request_type, description, priority, status, scheduled_for, submitted_at, acknowledged_at, completed_at')
    .eq('reservation_id', req.params.reservationId)
    .eq('assigned_department', 'Engineering')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ requests: data || [] });
});

// Create maintenance request — resolves stay details server-side.
router.post('/maintenance/requests', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { reservationId, issueType, description, priority, scheduled_for } = req.body || {};
  if (!reservationId || !issueType || !description) {
    return res.status(400).json({ error: 'reservationId, issueType and description are required' });
  }

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, guest_name, room_number, property_id, status')
    .eq('id', String(reservationId))
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  if (resv.guest_id && !(await canActForGuest(req, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to report for this reservation' });
  }

  const priorityValue = MAINT_REQUEST_PRIORITIES.includes(priority) ? priority : 'Normal';
  const scheduledAt = scheduled_for ? new Date(scheduled_for) : null;
  const validSchedule = scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null;
  const requestNumber = `MNT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const { data, error } = await supabaseAdmin.from('guest_requests').insert({
    request_number: requestNumber,
    property_id: resv.property_id || null,
    reservation_id: resv.id,
    room_number: resv.room_number || null,
    guest_name: resv.guest_name || null,
    request_type: 'Maintenance',
    description: `${String(issueType).slice(0, 100)} · ${String(description).slice(0, 1900)}`,
    priority: priorityValue,
    status: 'Open',
    assigned_department: 'Engineering',
    scheduled_for: validSchedule ? validSchedule.toISOString() : null,
    submitted_at: new Date().toISOString(),
  }).select('id, request_number, request_type, description, priority, status, submitted_at').single();

  if (error) return res.status(500).json({ error: error.message });

  // Engineering reads work_requests, not guest_requests — bridge the report
  // into their intake queue so engineers actually see it.
  try {
    const seq = Date.now().toString().slice(-6);
    await supabaseAdmin.from('work_requests').insert({
      id: `WR-${seq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      property_id: resv.property_id || null,
      wr_number: `WR-${new Date().getFullYear()}-${seq}`,
      source: 'Guest',
      source_type: 'Guest Portal',
      location: resv.room_number ? `Room ${resv.room_number}` : 'Guest Room',
      room_number: resv.room_number || null,
      priority: priorityValue === 'Urgent' ? 'Emergency' : priorityValue,
      type: String(issueType).slice(0, 100),
      description: `${requestNumber} — ${String(description).slice(0, 1900)}`,
      requested_by: resv.guest_name || 'Guest',
      status: 'Pending',
    });
  } catch (e: any) {
    console.warn('maintenance work_request bridge failed:', e?.message);
  }

  await emitGuestNotification({
    guestId: resv.guest_id,
    reservationId: resv.id,
    propertyId: resv.property_id,
    category: 'request_update',
    title: 'Maintenance request received',
    message: `${requestNumber}: ${String(issueType).slice(0, 80)} — engineering has been notified.`,
  });

  cacheService.invalidate('guest-*');
  cacheService.invalidate('eng-*');
  return res.status(201).json({ request: data });
});

// Guests may cancel only their own still-open maintenance requests.
router.patch('/maintenance/requests/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('guest_requests')
    .select('id, reservation_id, status')
    .eq('id', req.params.id)
    .eq('assigned_department', 'Engineering')
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.status !== 'Open') {
    return res.status(400).json({ error: 'Only open requests can be cancelled' });
  }

  if (existing.reservation_id) {
    const { data: resv } = await supabaseAdmin
      .from('reservations')
      .select('guest_id')
      .eq('id', existing.reservation_id)
      .maybeSingle();
    if (resv?.guest_id && !(await canActForGuest(req, resv.guest_id))) {
      return res.status(403).json({ error: 'Not authorized to cancel this request' });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('id, request_number, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('guest-*');
  cacheService.invalidate('eng-*');
  return res.json({ request: data });
});

// ── Concierge Services ───────────────────────────────────────────────────────
// Serviced from the shared `guest_services` catalog and `guest_requests`
// queue — the same tables the staff Concierge portal reads, so guest
// submissions land directly in the concierge service queue.
const CONCIERGE_SERVICE_CATEGORIES = [
  'concierge', 'tour', 'ticketing', 'shopping', 'itinerary',
  'luggage', 'parcel', 'vip', 'wakeup',
];

// Maps catalog categories to the canonical guest_requests.request_type
// vocabulary the staff Concierge portal modules and type-filtered reports
// read — guest bookings must land in the same typed queues as staff-created
// requests. 'concierge' covers the in-city experiences catalog (category
// 'concierge' in guest_services) which staff track as Experience Booking;
// 'transportation' matches the seeded request type and the transport KPI.
const CONCIERGE_CATEGORY_REQUEST_TYPE: Record<string, string> = {
  concierge: 'Experience Booking',
  tour: 'Tour Booking',
  ticketing: 'Ticket Booking',
  shopping: 'Personal Shopping',
  itinerary: 'Itinerary Planning',
  luggage: 'Luggage',
  parcel: 'Package',
  vip: 'VIP Service',
  wakeup: 'Wake-up Call',
  transportation: 'Transportation',
};

// Get concierge services (mobile contract — property-scoped URL; the catalog
// itself is global so propertyId only echoes back in the response).
router.get('/concierge/services/:propertyId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data, error } = await supabaseAdmin
    .from('guest_services')
    .select('*')
    .in('category', CONCIERGE_SERVICE_CATEGORIES)
    .eq('available', true)
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    propertyId: req.params.propertyId,
    services: data || [],
  });
});

// Guest-scoped catalog — mirrors /transport/catalog/:guestId.
router.get('/concierge/catalog/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this guest’s catalog' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_services')
    .select('id, name, description, category, price')
    .in('category', CONCIERGE_SERVICE_CATEGORIES)
    .eq('available', true)
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ services: data || [] });
});

// The guest's own concierge requests — resolved through their reservations.
router.get('/concierge/requests/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this guest’s requests' });
  }

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('guest_id', req.params.guestId);
  const reservationIds = (resv || []).map((r: any) => r.id);
  if (reservationIds.length === 0) return res.json({ requests: [] });

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .select('id, request_number, reservation_id, room_number, request_type, description, priority, status, notes, rating, feedback, scheduled_for, submitted_at, acknowledged_at, completed_at')
    .in('reservation_id', reservationIds)
    .eq('assigned_department', 'Concierge')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  // The concierge "Guest Feedback Prompt" toggle decides whether completed
  // requests offer a rating control.
  const { data: promptSetting } = await supabaseAdmin
    .from('concierge_settings')
    .select('value')
    .eq('id', 'service.feedback-prompt')
    .maybeSingle();

  return res.json({
    requests: data || [],
    feedback_prompt: promptSetting?.value?.enabled !== false,
  });
});

// Request concierge service — writes into the shared guest_requests queue
// (assigned_department='Concierge') so staff see it immediately.
router.post('/concierge/requests', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    guest_id,
    reservation_id,
    service_id,
    service_name,
    request_details,
    scheduled_for,
  } = req.body || {};

  const description = request_details || req.body?.description;
  if (!guest_id || !description) {
    return res.status(400).json({ error: 'guest_id and request_details are required' });
  }
  if (!(await canActForGuest(req, guest_id))) {
    return res.status(403).json({ error: 'Not authorized to request for this guest' });
  }

  // Resolve guest + stay details server-side.
  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name')
    .eq('id', guest_id)
    .maybeSingle();
  if (!guest) return res.status(400).json({ error: 'Unknown guest' });

  let resv: any = null;
  if (reservation_id) {
    const { data } = await supabaseAdmin
      .from('reservations')
      .select('id, guest_id, guest_name, room_number, property_id')
      .eq('id', reservation_id)
      .maybeSingle();
    if (data && data.guest_id === guest_id) resv = data;
  }

  // Resolve the catalog service for the request_type label.
  let service: any = null;
  if (service_id) {
    const { data } = await supabaseAdmin
      .from('guest_services')
      .select('id, name, category')
      .eq('id', service_id)
      .eq('available', true)
      .maybeSingle();
    service = data || null;
  }
  const requestType = (service && CONCIERGE_CATEGORY_REQUEST_TYPE[service.category])
    || service?.name
    || service_name
    || 'Concierge';

  const scheduledAt = scheduled_for ? new Date(scheduled_for) : null;
  const validSchedule = scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null;
  const notes = validSchedule
    ? `Requested for ${validSchedule.toLocaleString('en-US')}`
    : null;
  // Wake-up calls must land inside the configured scheduling window.
  const windowError = await wakeupWindowError(requestType, validSchedule?.toISOString(), resv?.property_id);
  if (windowError) return res.status(400).json({ error: windowError });

  // Apply portal defaults: configured default priority, desk-hours routing
  // to the Duty Manager, and least-loaded auto-assign.
  const defaults = await conciergeRequestDefaults({ propertyId: resv?.property_id });

  const requestNumber = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  // Keep the booked catalog item in the description — the canonical
  // request_type no longer carries it, and the concierge experience-sales
  // report prices bookings from `description.split('·')[0]`.
  const serviceLabel = service?.name || service_name || null;
  const fullDescription = serviceLabel
    ? `${serviceLabel} · ${description}`
    : String(description);

  const { data, error } = await supabaseAdmin.from('guest_requests').insert({
    request_number: requestNumber,
    property_id: resv?.property_id || null,
    reservation_id: resv?.id || null,
    room_number: resv?.room_number || null,
    guest_name: resv?.guest_name || guest.name,
    request_type: requestType,
    description: fullDescription.slice(0, 2000),
    priority: defaults.priority,
    status: 'Open',
    assigned_department: 'Concierge',
    assigned_to: defaults.assignedTo,
    notes,
    scheduled_for: validSchedule ? validSchedule.toISOString() : null,
    submitted_at: new Date().toISOString(),
  }).select('id, request_number, request_type, description, status, submitted_at').single();

  if (error) return res.status(500).json({ error: error.message });

  // notifications.auto-reply: post a guest-visible confirmation message.
  if ((await getConciergeSettings(['notifications.auto-reply']))['notifications.auto-reply']?.enabled === true) {
    const { error: replyErr } = await supabaseAdmin.from('guest_communications').insert({
      guest_id: guest.id,
      reservation_id: resv?.id || null,
      room_number: resv?.room_number || null,
      message: `Request received: ${requestType} — ${fullDescription.slice(0, 500)}`,
      message_type: 'Request',
      status: 'Resolved',
      reply: `Your request ${data.request_number} has been received and the concierge team is on it.`,
      replied_by: 'Concierge (auto-reply)',
      replied_at: new Date().toISOString(),
    });
    if (replyErr) console.error('Concierge auto-reply insert failed:', replyErr.message);
  }

  // notifications.enable-alerts: surface new guest requests to the concierge
  // desk immediately instead of relying on staff polling.
  if ((await getConciergeSettings(['notifications.enable-alerts']))['notifications.enable-alerts']?.enabled !== false
    && resv?.property_id) {
    const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: resv.property_id,
      message: `New concierge request ${data.request_number} — ${requestType} for ${resv.guest_name || guest.name}${resv.room_number ? ` (Room ${resv.room_number})` : ''}`,
      type: 'info',
      department: 'Concierge',
      read: false,
    });
    if (notifErr) console.warn('Concierge new-request notification insert failed:', notifErr.message);
  }

  await emitGuestNotification({
    guestId: guest.id,
    reservationId: resv?.id || null,
    propertyId: resv?.property_id || (await guestPropertyId(guest.id)),
    category: 'request_update',
    title: 'Request received',
    message: `${data.request_number}: ${requestType} — the concierge team has been notified.`,
  });

  cacheService.invalidate('guest-*');
  return res.status(201).json({ request: data });
});

// Guests rate a completed concierge request (1-5 + optional feedback).
router.patch('/concierge/requests/:id/rating', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
  }
  const feedback = req.body?.feedback ? String(req.body.feedback).trim().slice(0, 1000) : null;

  const { data: request } = await supabaseAdmin
    .from('guest_requests')
    .select('id, status, reservation_id')
    .eq('id', req.params.id)
    .eq('assigned_department', 'Concierge')
    .maybeSingle();
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'Completed') {
    return res.status(409).json({ error: 'Only completed requests can be rated' });
  }

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id')
    .eq('id', request.reservation_id)
    .maybeSingle();
  if (!resv?.guest_id || !(await canActForGuest(req, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to rate this request' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .update({ rating, feedback, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .select('id, rating, feedback')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('guest-*');
  return res.json({ request: data });
});

// Guests may cancel only their own still-open concierge requests.
router.patch('/concierge/requests/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('guest_requests')
    .select('id, reservation_id, status, assigned_department')
    .eq('id', req.params.id)
    .eq('assigned_department', 'Concierge')
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.status !== 'Open') {
    return res.status(400).json({ error: 'Only open requests can be cancelled' });
  }

  // Ownership check: the reservation linked to the request must belong to a
  // guest the caller may act for.
  if (existing.reservation_id) {
    const { data: resv } = await supabaseAdmin
      .from('reservations')
      .select('guest_id')
      .eq('id', existing.reservation_id)
      .maybeSingle();
    if (resv?.guest_id && !(await canActForGuest(req, resv.guest_id))) {
      return res.status(403).json({ error: 'Not authorized to cancel this request' });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('guest_requests')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, request_number, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ request: data });
});

// ── Guest Communications (Messaging Center) ────────────────────────────────
// Guests read their own thread — the same guest_communications rows that
// concierge staff reply to via /api/concierge/communications/:id/reply.
const COMMUNICATION_TYPES = ['Request', 'Booking', 'Inquiry', 'Complaint', 'Other'];

router.get('/communications/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id')
    .eq('id', req.params.reservationId)
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  // The path reservationId is the bearer credential on guest surfaces — feed
  // it to canActForGuest, which only inspects body/query.
  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (resv.guest_id && !(await canActForGuest(authReq, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to read this thread' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_communications')
    .select('id, reservation_id, room_number, message, message_type, status, reply, replied_by, replied_at, created_at')
    .eq('reservation_id', resv.id)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ messages: data || [] });
});

// Guest sends a message to the hotel — lands in the staff communications queue.
router.post('/communications', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { reservation_id, message, message_type } = req.body || {};
  if (!reservation_id || !message || !String(message).trim()) {
    return res.status(400).json({ error: 'reservation_id and message are required' });
  }

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, room_number, property_id')
    .eq('id', reservation_id)
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  if (resv.guest_id && !(await canActForGuest(req, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to message for this reservation' });
  }

  const type = COMMUNICATION_TYPES.includes(message_type) ? message_type : 'Inquiry';

  const { data, error } = await supabaseAdmin
    .from('guest_communications')
    .insert({
      guest_id: resv.guest_id || null,
      reservation_id: resv.id,
      room_number: resv.room_number || null,
      message: String(message).trim().slice(0, 2000),
      message_type: type,
      status: 'Pending',
    })
    .select('id, reservation_id, room_number, message, message_type, status, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // notifications.enable-alerts: surface new guest messages to the concierge
  // desk immediately instead of relying on staff polling.
  if ((await getConciergeSettings(['notifications.enable-alerts']))['notifications.enable-alerts']?.enabled !== false
    && resv.property_id) {
    const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
      id: crypto.randomUUID(),
      property_id: resv.property_id,
      message: `New guest ${String(type).toLowerCase()}${resv.room_number ? ` from Room ${resv.room_number}` : ''}: ${String(message).trim().slice(0, 140)}`,
      type: 'info',
      department: 'Concierge',
      read: false,
    });
    if (notifErr) console.warn('Concierge new-message notification insert failed:', notifErr.message);
  }

  cacheService.invalidate('guest-*');
  return res.status(201).json({ message: data });
});

// ── Restaurant Reservations ────────────────────────────────────────────────
// Guest-facing dining bookings backed by the real F&B book: outlets +
// fb_tables + fb_table_reservations (booked_via='guest', table assigned by
// the host at seating).

const RESTAURANT_OUTLET_TYPES = ['Restaurant', 'Bar'];
const DEFAULT_DINING_SLOTS = ['12:00', '13:00', '18:00', '19:00', '20:00', '21:00'];
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Hourly start times inside the outlet's operating hours for `day`
// (last seating one hour before close), or a default set when unconfigured.
function slotsForOutlet(operatingHours: any, day: string): string[] {
  const hours = operatingHours?.[DAY_KEYS[new Date(`${day}T12:00:00`).getDay()]];
  if (!hours?.open || !hours?.close) return DEFAULT_DINING_SLOTS;
  const [oh, om] = String(hours.open).split(':').map(Number);
  const [ch, cm] = String(hours.close).split(':').map(Number);
  if ([oh, om, ch, cm].some(Number.isNaN)) return DEFAULT_DINING_SLOTS;
  const slots: string[] = [];
  for (let t = oh * 60 + om; t <= ch * 60 + cm - 60; t += 60) {
    slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return slots;
}

// Get available restaurant slots
router.get('/restaurants/availability/:propertyId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { date, partySize, restaurantId } = req.query as Record<string, string>;
  const day = date && !Number.isNaN(new Date(`${date}T12:00:00`).getTime())
    ? date
    : new Date().toISOString().slice(0, 10);
  const prevDay = new Date(`${day}T12:00:00`);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevDayISO = prevDay.toISOString().slice(0, 10);
  const party = Math.max(1, Math.floor(Number(partySize)) || 2);

  const cacheKey = `guest-restaurant-availability:${req.params.propertyId}:${day}:${party}:${restaurantId || 'all'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('outlets')
    .select('id, name, type, operating_hours')
    .eq('is_active', true)
    .in('type', RESTAURANT_OUTLET_TYPES);
  if (restaurantId) q = q.eq('id', restaurantId);

  const { data: outletRows, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const outletIds = (outletRows || []).map((o: any) => o.id);
  let tableRows: any[] = [];
  let bookingRows: any[] = [];
  if (outletIds.length > 0) {
    const [tablesRes, bookingsRes] = await Promise.all([
      supabaseAdmin
        .from('fb_tables')
        .select('id, outlet_id, seats')
        .eq('is_active', true)
        .in('outlet_id', outletIds),
      supabaseAdmin
        .from('fb_table_reservations')
        // Wide window: a late previous-day booking can overlap early slots.
        .select('outlet_id, arrival_time, duration, party_size')
        .in('outlet_id', outletIds)
        .in('status', ['confirmed', 'seated'])
        .gte('arrival_time', `${prevDayISO}T00:00:00`)
        .lte('arrival_time', `${day}T23:59:59`),
    ]);
    tableRows = tablesRes.data || [];
    bookingRows = bookingsRes.data || [];
  }

  const now = Date.now();
  const availability = (outletRows || []).map((outlet: any) => {
    // Table-identity-aware capacity: a slot is full only when no feasible
    // assignment of the day's bookings (plus the candidate) to real tables
    // exists. Outlets with no tables on the floor plan aren't
    // capacity-managed — their slots stay open.
    const outletTables = tableRows.filter((t) => t.outlet_id === outlet.id);
    const outletBookings = bookingRows.filter((b) => b.outlet_id === outlet.id);
    const availableSlots = slotsForOutlet(outlet.operating_hours, day).filter((slot) => {
      const arrival = new Date(`${day}T${slot}:00`).getTime();
      if (Number.isNaN(arrival) || arrival <= now) return false;
      if (outletTables.length === 0) return true;
      return canAccommodateBookings(outletTables, [
        ...outletBookings,
        { party_size: party, arrival_time: new Date(arrival).toISOString(), duration: 120 },
      ]);
    });
    return {
      restaurantId: outlet.id,
      restaurantName: outlet.name,
      outletType: outlet.type,
      availableSlots,
    };
  });

  const result = { propertyId: req.params.propertyId, date: day, partySize: party, availability };
  cacheService.set(cacheKey, result, 5 * 60 * 1000);
  return res.json(result);
});

// Make restaurant reservation
router.post('/restaurants/reservations', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    reservationId,
    restaurantId,
    date,
    time,
    partySize,
    specialRequests,
    arrival_time,
  } = req.body || {};

  if (!reservationId || !restaurantId || !partySize || (!arrival_time && (!date || !time))) {
    return res.status(400).json({ error: 'reservationId, restaurantId, partySize and a time (arrival_time or date+time) are required' });
  }
  const party = Math.floor(Number(partySize));
  if (!Number.isFinite(party) || party < 1 || party > 50) {
    return res.status(400).json({ error: 'partySize must be between 1 and 50' });
  }
  const arrival = new Date(arrival_time || `${date}T${String(time).slice(0, 5)}:00`);
  if (Number.isNaN(arrival.getTime())) {
    return res.status(400).json({ error: 'Invalid reservation time' });
  }
  if (arrival.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Reservation time must be in the future' });
  }

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, guest_name, property_id')
    .eq('id', reservationId)
    .maybeSingle();
  if (!resv) return res.status(404).json({ error: 'Reservation not found' });
  if (resv.guest_id && !(await canActForGuest(req, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to book for this reservation' });
  }

  const { data: outlet } = await supabaseAdmin
    .from('outlets')
    .select('id, name, type, is_active')
    .eq('id', restaurantId)
    .maybeSingle();
  if (!outlet || !outlet.is_active) {
    return res.status(404).json({ error: 'Restaurant not found or inactive' });
  }

  // Same capacity rule as the availability endpoint: simulate a real table
  // assignment — the slot is full only when no feasible placement exists.
  const { data: tables } = await supabaseAdmin
    .from('fb_tables')
    .select('id, seats')
    .eq('outlet_id', outlet.id)
    .eq('is_active', true);
  if ((tables || []).length > 0) {
    const { data: nearby } = await supabaseAdmin
      .from('fb_table_reservations')
      .select('id, arrival_time, duration, party_size')
      .eq('outlet_id', outlet.id)
      .in('status', ['confirmed', 'seated'])
      .gte('arrival_time', new Date(arrival.getTime() - 12 * 3600 * 1000).toISOString())
      .lte('arrival_time', new Date(arrival.getTime() + 12 * 3600 * 1000).toISOString());
    const feasible = canAccommodateBookings(tables || [], [
      ...(nearby || []),
      { party_size: party, arrival_time: arrival.toISOString(), duration: 120 },
    ]);
    if (!feasible) {
      return res.status(409).json({ error: `${outlet.name} is fully booked at that time` });
    }
  }

  const { data, error } = await supabaseAdmin.from('fb_table_reservations').insert({
    outlet_id: outlet.id,
    table_id: null,
    reservation_id: resv.id,
    guest_name: resv.guest_name,
    party_size: party,
    arrival_time: arrival.toISOString(),
    duration: 120,
    status: 'confirmed',
    special_requests: specialRequests ? String(specialRequests).slice(0, 1000) : null,
    confirmed_by: req.user?.name || req.user?.id || null,
    booked_via: 'guest',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await emitGuestNotification({
    guestId: resv.guest_id,
    reservationId: resv.id,
    propertyId: resv.property_id,
    category: 'restaurant',
    title: 'Table reserved',
    message: `${outlet.name} — ${arrival.toLocaleString()}, party of ${party}.`,
  });

  cacheService.invalidate('guest-*');
  cacheService.invalidate('fb-*');
  return res.status(201).json(data);
});

// Overview for the /guest/restaurant tab: the reservation's property,
// its restaurant/bar outlets with operating hours, and the guest's
// existing dining bookings — one round-trip.
router.get('/restaurants/overview/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: reservation, error: resError } = await supabaseAdmin
    .from('reservations')
    .select('id, property_id, guest_id, guest_name, status')
    .eq('id', req.params.reservationId)
    .maybeSingle();
  if (resError) return res.status(500).json({ error: resError.message });
  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (reservation.guest_id && !(await canActForGuest(authReq, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view these bookings' });
  }

  let q = supabaseAdmin
    .from('outlets')
    .select('id, name, type, operating_hours')
    .eq('is_active', true)
    .in('type', RESTAURANT_OUTLET_TYPES)
    .order('name', { ascending: true });
  if (reservation.property_id) q = q.eq('property_id', reservation.property_id);
  const { data: outletRows, error: outError } = await q;
  if (outError) return res.status(500).json({ error: outError.message });

  const { data: bookings, error: bookError } = await supabaseAdmin
    .from('fb_table_reservations')
    .select('id, outlet_id, reservation_id, guest_name, party_size, arrival_time, duration, status, special_requests, created_at')
    .eq('reservation_id', req.params.reservationId)
    .order('arrival_time', { ascending: false })
    .limit(50);
  if (bookError) return res.status(500).json({ error: bookError.message });

  const outletNames = new Map((outletRows || []).map(o => [o.id, o.name]));
  const todayKey = DAY_KEYS[new Date().getDay()];

  return res.json({
    reservation: {
      id: reservation.id,
      guestId: reservation.guest_id,
      guestName: reservation.guest_name,
      propertyId: reservation.property_id,
      status: reservation.status,
    },
    restaurants: (outletRows || []).map(o => ({
      id: o.id,
      name: o.name,
      type: o.type,
      operatingHours: o.operating_hours || {},
      todayHours: o.operating_hours?.[todayKey] || null,
    })),
    bookings: (bookings || []).map(b => ({
      id: b.id,
      outletId: b.outlet_id,
      restaurantName: outletNames.get(b.outlet_id) || 'Restaurant',
      arrivalTime: b.arrival_time,
      partySize: b.party_size,
      duration: b.duration,
      status: b.status || 'confirmed',
      specialRequests: b.special_requests,
      createdAt: b.created_at,
    })),
  });
});

// Guest cancels a dining booking while it is still upcoming
router.patch('/restaurants/reservations/:bookingId/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('fb_table_reservations')
    .select('id, reservation_id, status, arrival_time')
    .eq('id', req.params.bookingId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('guest_id')
    .eq('id', existing.reservation_id)
    .maybeSingle();
  if (resv?.guest_id && !(await canActForGuest(req, resv.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to cancel this booking' });
  }
  if (String(existing.status) !== 'confirmed') {
    return res.status(409).json({ error: `A ${existing.status} booking cannot be cancelled` });
  }
  if (existing.arrival_time && new Date(existing.arrival_time).getTime() <= Date.now()) {
    return res.status(409).json({ error: 'A past booking cannot be cancelled' });
  }

  const { error } = await supabaseAdmin
    .from('fb_table_reservations')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.bookingId);
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  cacheService.invalidate('fb-*');
  cacheService.invalidate(`guest-restaurant-availability:*`);
  return res.json({ ok: true, id: req.params.bookingId, status: 'cancelled' });
});

// ── Spa & Wellness ────────────────────────────────────────────────────────
// Guest-facing booking backed by spa_appointments with the same conflict,
// roster and wellness-safety checks as the staff portal (spaService).

// (canActForGuest, guestPropertyId and the proxy-role vocabulary live in
// spaService so every guest-facing surface — this router and the legacy
// guestPortal.routes.ts — applies the same rule.)

// Treatment catalog for the guest's home property (shared rows + property
// rows). Falls back to shared-only when the guest has no property.
router.get('/spa/catalog/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this guest’s catalog' });
  }

  const propId = await guestPropertyId(req.params.guestId);
  const cacheKey = `spa-treatments:${propId ?? 'shared'}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  let q = supabaseAdmin
    .from('spa_treatments')
    .select('id, name, category, description, duration_minutes, price, is_popular, room_type')
    .eq('is_active', true);
  q = propId ? q.or(`property_id.is.null,property_id.eq.${propId}`) : q.is('property_id', null);

  const { data, error } = await q.order('is_popular', { ascending: false }).order('name');
  if (error) return res.status(500).json({ error: error.message });

  const result = {
    treatments: (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description || '',
      duration: t.duration_minutes,
      price: Number(t.price) || 0,
      popular: !!t.is_popular,
      roomType: t.room_type || null,
    })),
  };
  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

// Providers actually working and free at the requested slot — lets the guest
// picker only offer bookable therapists.
router.get('/spa/availability', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guestId, date, startTime, duration } = req.query as Record<string, string>;
  if (!guestId || !date || !startTime) {
    return res.status(400).json({ error: 'guestId, date and startTime query params are required' });
  }
  if (!(await canActForGuest(req, guestId))) {
    return res.status(403).json({ error: 'Not authorized for this guest' });
  }
  const propId = await guestPropertyId(guestId);

  let q = supabaseAdmin
    .from('spa_therapists')
    .select('id, name, title, specialties, status')
    .eq('status', 'Active');
  q = propId ? q.or(`property_id.is.null,property_id.eq.${propId}`) : q.is('property_id', null);
  const { data: therapists, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const durationMin = Math.max(15, Number(duration) || 60);
  const available: Array<{ id: string; name: string; title: string | null }> = [];

  for (const t of therapists || []) {
    const day = await providerDayStatus(t.id, date, propId);
    if (day.isOff) continue;
    const start = timeToMin(startTime);
    if (day.window && start !== null && (start < day.window.start || start + durationMin > day.window.end)) continue;
    const conflicts = await findAppointmentConflicts({
      date, startTime, durationMin, therapistId: t.id, propertyId: propId,
    });
    if (!conflicts.length) available.push({ id: t.id, name: t.name, title: t.title || null });
  }

  return res.json({ date, startTime, providers: available });
});

router.post('/spa/bookings', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    guest_id, treatment_id, therapist_id,
    appointment_date, start_time, notes,
    reservation_id, reservationId: reservationIdCamel,
  } = req.body || {};

  if (!guest_id || !treatment_id || !appointment_date || !start_time) {
    return res.status(400).json({ error: 'guest_id, treatment_id, appointment_date and start_time are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
    return res.status(400).json({ error: 'appointment_date must be YYYY-MM-DD' });
  }
  if (timeToMin(start_time) === null) {
    return res.status(400).json({ error: 'start_time must be HH:MM' });
  }
  if (appointment_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Cannot book a past date' });
  }

  // Resolve the guest server-side — name and home property come from the
  // guests record, not from client input.
  if (!(await canActForGuest(req, guest_id))) {
    return res.status(403).json({ error: 'Not authorized to book for this guest' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name')
    .eq('id', guest_id)
    .maybeSingle();
  if (!guest) return res.status(400).json({ error: 'Unknown guest' });
  const guest_name = guest.name;
  const propId = await guestPropertyId(guest_id);

  const { data: treatment } = await supabaseAdmin
    .from('spa_treatments')
    .select('id, name, duration_minutes, price, is_active, therapist_qualifications, room_type')
    .eq('id', treatment_id)
    .maybeSingle();
  if (!treatment || !treatment.is_active) {
    return res.status(400).json({ error: 'Unknown or unavailable treatment' });
  }

  const duration = Number(treatment.duration_minutes) || 60;
  const warnings: string[] = [];

  try {
    // Same enforcement as the staff portal: therapist must be working and free.
    if (therapist_id) {
      const day = await providerDayStatus(therapist_id, appointment_date, propId);
      if (day.isOff) {
        return res.status(409).json({ error: 'Selected provider is not working on that date' });
      }
      const start = timeToMin(start_time)!;
      if (day.window && (start < day.window.start || start + duration > day.window.end)) {
        return res.status(409).json({ error: `Selected time is outside the provider's ${day.shift} shift` });
      }
      const conflicts = await findAppointmentConflicts({
        date: appointment_date, startTime: start_time,
        durationMin: duration, therapistId: therapist_id, propertyId: propId,
      });
      if (conflicts.length) {
        return res.status(409).json({ error: 'Selected provider is already booked at that time' });
      }
    }
    // Therapist qualifications + operating-hours window (migration 498).
    warnings.push(...await checkBookingResources({
      treatment,
      therapistId: therapist_id,
      date: appointment_date,
      startTime: start_time,
      durationMin: duration,
    }));
  } catch (e: any) {
    if (e instanceof SpaError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  for (const w of await guestWellnessWarnings(guest_id, propId)) warnings.push(w);

  let therapistName: string | null = null;
  if (therapist_id) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', therapist_id).maybeSingle();
    therapistName = th?.name ?? null;
  }

  const id = await nextSpaId('APT-');
  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .insert({
      id,
      guest_id,
      guest_name,
      treatment_id,
      treatment: treatment.name,
      therapist_id: therapist_id || null,
      therapist: therapistName,
      appointment_date,
      start_time,
      duration_minutes: duration,
      status: 'Requested',
      source: 'Guest Portal',
      amount: treatment.price,
      notes: notes || null,
      property_id: propId,
    })
    .select()
    .single();

  if (error?.code === '23P01') {
    return res.status(409).json({ error: 'That slot was just taken — please pick another time' });
  }
  if (error) return res.status(500).json({ error: error.message });

  if (warnings.some(w => w.startsWith('Allergies') || w.startsWith('Contraindications'))) {
    await recordContraindicationAlert({
      guestId: guest_id,
      appointmentId: id,
      therapistId: therapist_id,
      message: `Guest-portal booking ${id} for ${guest_name}: ${warnings.join(' | ')}`,
      propertyId: propId,
    });
  }

  await emitGuestNotification({
    guestId: guest_id,
    reservationId: reservation_id || reservationIdCamel || null,
    propertyId: propId,
    category: 'spa',
    title: 'Spa appointment booked',
    message: `${data?.treatment || 'Treatment'} on ${data?.appointment_date || ''} at ${data?.start_time || ''}${data?.therapist ? ` with ${data.therapist}` : ''}.`,
  });

  return res.status(201).json({ ...data, warnings });
});

router.get('/spa/bookings/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this guest\u2019s bookings' });
  }

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, guest_id, guest_name, treatment, therapist, appointment_date, start_time, duration_minutes, status, amount, source, created_at')
    .eq('guest_id', req.params.guestId)
    .order('appointment_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookings: data || [] });
});

// Guests may cancel only their own Requested/Confirmed bookings. Identity is
// verified from the session/reservation, never a client-supplied guest_id.
router.patch('/spa/bookings/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { reason } = req.body || {};

  const { data: appt } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, guest_id, guest_name, status, treatment, therapist_id, appointment_date, start_time, amount, property_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!appt) return res.status(404).json({ error: 'Booking not found' });
  if (!(await canActForGuest(req, appt.guest_id))) {
    return res.status(403).json({ error: 'You can only cancel your own bookings' });
  }
  if (!['Requested', 'Confirmed'].includes(appt.status)) {
    return res.status(409).json({ error: `Cannot cancel a booking that is ${appt.status}` });
  }

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || 'Cancelled by guest',
      updated_at: new Date().toISOString(),
    })
    .eq('id', appt.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Late-cancellation fee per the 'Cancellation Fee' spa_setting — same
  // policy the staff portal applies (0% = disabled).
  const warnings: string[] = [];
  try {
    const fee = await applyCancellationFee(data);
    if (fee > 0) warnings.push(`A late-cancellation fee of $${fee.toFixed(2)} applies`);
  } catch (feeErr) {
    console.error('Guest cancellation fee failed:', feeErr);
  }

  await flagWaitlistForFreedSlot(appt);

  await recordAppointmentHistory({
    appointmentId: appt.id,
    action: 'cancelled',
    fromStatus: appt.status,
    toStatus: 'Cancelled',
    changedBy: req.user?.id || 'guest',
    changedByName: req.user?.name || appt.guest_id,
    notes: reason || 'Cancelled by guest',
    propertyId: data.property_id,
  });
  return res.json({ ...data, warnings });
});

// Guests may move their own Requested/Confirmed booking to a new date/time —
// same slot/roster/resource checks as a fresh booking, and the freed slot is
// offered to the waitlist.
router.patch('/spa/bookings/:id/reschedule', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { appointment_date, start_time, therapist_id } = req.body || {};
  if (!appointment_date || !start_time) {
    return res.status(400).json({ error: 'appointment_date and start_time are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
    return res.status(400).json({ error: 'appointment_date must be YYYY-MM-DD' });
  }
  if (timeToMin(start_time) === null) {
    return res.status(400).json({ error: 'start_time must be HH:MM' });
  }
  if (appointment_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Cannot move a booking to a past date' });
  }

  const { data: appt } = await supabaseAdmin
    .from('spa_appointments')
    .select('id, guest_id, guest_name, status, treatment, treatment_id, therapist_id, appointment_date, start_time, duration_minutes, property_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!appt) return res.status(404).json({ error: 'Booking not found' });
  if (!(await canActForGuest(req, appt.guest_id))) {
    return res.status(403).json({ error: 'You can only reschedule your own bookings' });
  }
  if (!['Requested', 'Confirmed'].includes(appt.status)) {
    return res.status(409).json({ error: `Cannot reschedule a booking that is ${appt.status}` });
  }

  const propId = appt.property_id || await guestPropertyId(appt.guest_id);
  const newTherapistId = therapist_id !== undefined ? (therapist_id || null) : appt.therapist_id;
  const duration = Number(appt.duration_minutes) || 60;
  const warnings: string[] = [];

  try {
    if (newTherapistId) {
      const day = await providerDayStatus(newTherapistId, appointment_date, propId);
      if (day.isOff) {
        return res.status(409).json({ error: 'Selected provider is not working on that date' });
      }
      const start = timeToMin(start_time)!;
      if (day.window && (start < day.window.start || start + duration > day.window.end)) {
        return res.status(409).json({ error: `Selected time is outside the provider's ${day.shift} shift` });
      }
      const conflicts = await findAppointmentConflicts({
        date: appointment_date, startTime: start_time,
        durationMin: duration, therapistId: newTherapistId, propertyId: propId,
        excludeId: appt.id,
      });
      if (conflicts.length) {
        return res.status(409).json({ error: 'Selected provider is already booked at that time' });
      }
    }
    const { data: treatment } = await supabaseAdmin
      .from('spa_treatments')
      .select('id, therapist_qualifications, room_type')
      .eq('id', appt.treatment_id)
      .maybeSingle();
    warnings.push(...await checkBookingResources({
      treatment: treatment || {},
      therapistId: newTherapistId,
      date: appointment_date,
      startTime: start_time,
      durationMin: duration,
    }));
  } catch (e: any) {
    if (e instanceof SpaError) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  let therapistName: string | null = null;
  if (newTherapistId) {
    const { data: th } = await supabaseAdmin
      .from('spa_therapists').select('name').eq('id', newTherapistId).maybeSingle();
    therapistName = th?.name ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from('spa_appointments')
    .update({
      appointment_date,
      start_time,
      therapist_id: newTherapistId,
      therapist: therapistName,
      status: 'Rescheduled',
      reminder_sent_at: null, // re-arm the reminder for the new slot
      updated_at: new Date().toISOString(),
    })
    .eq('id', appt.id)
    .select()
    .single();

  if (error?.code === '23P01') {
    return res.status(409).json({ error: 'That slot was just taken — please pick another time' });
  }
  if (error) return res.status(500).json({ error: error.message });

  // The old slot is now free — notify matching waitlist entries.
  await flagWaitlistForFreedSlot(appt);

  await recordAppointmentHistory({
    appointmentId: appt.id,
    action: 'rescheduled',
    fromStatus: appt.status,
    toStatus: 'Rescheduled',
    changedBy: req.user?.id || 'guest',
    changedByName: req.user?.name || appt.guest_id,
    notes: `Rescheduled from ${appt.appointment_date} ${appt.start_time} to ${appointment_date} ${start_time}`,
    propertyId: data.property_id,
  });
  return res.json({ ...data, warnings });
});

// Guests may join the waitlist for a preferred date/treatment.
router.post('/spa/waitlist', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { guest_id, treatment_id, therapist_id, preferred_date, preferred_time, notes } = req.body || {};
  if (!guest_id || !preferred_date) {
    return res.status(400).json({ error: 'guest_id and preferred_date are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) {
    return res.status(400).json({ error: 'preferred_date must be YYYY-MM-DD' });
  }
  if (preferred_time && timeToMin(preferred_time) === null) {
    return res.status(400).json({ error: 'preferred_time must be HH:MM' });
  }
  if (preferred_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Cannot waitlist a past date' });
  }
  if (!(await canActForGuest(req, guest_id))) {
    return res.status(403).json({ error: 'Not authorized to waitlist for this guest' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests').select('id, name, email, phone').eq('id', guest_id).maybeSingle();
  if (!guest) return res.status(400).json({ error: 'Unknown guest' });
  const propId = await guestPropertyId(guest_id);

  let treatmentName: string | null = null;
  if (treatment_id) {
    const { data: t } = await supabaseAdmin
      .from('spa_treatments').select('name, is_active').eq('id', treatment_id).maybeSingle();
    if (!t || !t.is_active) return res.status(400).json({ error: 'Unknown or unavailable treatment' });
    treatmentName = t.name;
  }

  const { data, error } = await supabaseAdmin
    .from('spa_waitlist')
    .insert({
      id: await nextSpaId('WLT-'),
      guest_id,
      guest_name: guest.name,
      contact: guest.email || guest.phone || null,
      treatment_id: treatment_id || null,
      treatment: treatmentName || 'Any treatment',
      therapist_id: therapist_id || null,
      preferred_date,
      preferred_time: preferred_time || null,
      status: 'Waiting',
      notes: notes || null,
      property_id: propId,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── Phase 4: Guest Preferences Management ─────────────────────────────────
// Get guest preferences
router.get('/preferences/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  
  const { data: preferences } = await supabaseAdmin
    .from('guest_preferences')
    .select('*')
    .eq('guest_id', req.params.guestId);

  const grouped = {
    room: preferences?.filter(p => p.category === 'room') || [],
    dining: preferences?.filter(p => p.category === 'dining') || [],
    amenities: preferences?.filter(p => p.category === 'amenities') || [],
    service: preferences?.filter(p => p.category === 'service') || [],
    accessibility: preferences?.filter(p => p.category === 'accessibility') || [],
  };

  return res.json({
    guestId: req.params.guestId,
    preferences: grouped,
  });
});

// Update guest preferences
router.put('/preferences/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }
  
  const { preferences } = req.body || [];

  await supabaseAdmin
    .from('guest_preferences')
    .delete()
    .eq('guest_id', req.params.guestId);

  const { data, error } = await supabaseAdmin.from('guest_preferences').insert(
    preferences.map((p: any) => ({
      guest_id: req.params.guestId,
      category: p.category,
      preference: p.preference,
      value: p.value,
      created_at: new Date().toISOString(),
    }))
  ).select();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ preferences: data || [] });
});

// ── Guest Self-Service Profile ──────────────────────────────────────────────
// Reads/writes the shared `guests` row. Stay preferences live in the
// guests.preferences JSONB using the same keys the front-office Guest Profiles
// module edits (bedType, pillowType, dietary, …) so both portals stay in sync.
const LANGUAGE_CODE_TO_NAME: Record<string, string> = { en: 'English', am: 'Amharic', ti: 'Tigrinya' };
const LANGUAGE_NAME_TO_CODE: Record<string, string> = { english: 'en', amharic: 'am', tigrinya: 'ti' };

function mapGuestProfile(guest: any) {
  const prefs = (guest.preferences || {}) as Record<string, any>;
  const nameParts = String(guest.name || '').trim().split(/\s+/).filter(Boolean);
  const languageCode =
    prefs.preferredLanguage ||
    LANGUAGE_NAME_TO_CODE[String(prefs.language || '').toLowerCase()] ||
    'en';
  return {
    profile: {
      firstName: guest.first_name || nameParts[0] || '',
      lastName: guest.last_name || nameParts.slice(1).join(' ') || '',
      email: guest.email || '',
      phone: guest.phone || '',
      nationality: guest.nationality || '',
      preferredLanguage: languageCode,
      preferredCurrency: prefs.preferredCurrency || 'USD',
    },
    stayPreferences: {
      bedType: prefs.bedType || 'King',
      pillowType: prefs.pillowType || 'Medium',
      floorPreference: prefs.floorPreference || 'Any',
      smokingPreference: prefs.smokingPreference || 'Non-Smoking',
      roomTemperature: typeof prefs.roomTemperature === 'number' ? prefs.roomTemperature : 22,
      // dietaryPreferences[] is the guest-portal shape; fall back to the FO
      // single `dietary` string so FO-entered data shows up here.
      dietaryPreferences: Array.isArray(prefs.dietaryPreferences)
        ? prefs.dietaryPreferences
        : (prefs.dietary && prefs.dietary !== 'None' ? String(prefs.dietary).split(',').map((s: string) => s.trim()).filter(Boolean) : []),
      allergies: Array.isArray(prefs.allergies) ? prefs.allergies : [],
      accessibilityNeeds: Array.isArray(prefs.accessibilityNeeds) ? prefs.accessibilityNeeds : [],
    },
  };
}

// Get the guest's profile + stay preferences
router.get('/profile/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  const { data: guest, error } = await supabaseAdmin
    .from('guests')
    .select('id, name, first_name, last_name, email, phone, nationality, status, loyalty_points, preferences')
    .eq('id', req.params.guestId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  return res.json({
    guestId: guest.id,
    status: guest.status,
    loyaltyPoints: guest.loyalty_points || 0,
    ...mapGuestProfile(guest),
  });
});

// Update the guest's profile + stay preferences (merged into preferences JSONB)
router.put('/profile/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  const { profile, stayPreferences } = req.body || {};
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: 'profile object is required' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('guests')
    .select('preferences')
    .eq('id', req.params.guestId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Guest not found' });

  const firstName = String(profile.firstName || '').trim();
  const lastName = String(profile.lastName || '').trim();
  const langCode = String(profile.preferredLanguage || 'en');

  // Merge — preserve keys owned by other portals (emergencyContact, company, …)
  const mergedPrefs: Record<string, any> = {
    ...((existing.preferences || {}) as Record<string, any>),
    preferredLanguage: langCode,
    language: LANGUAGE_CODE_TO_NAME[langCode] || 'English',
    preferredCurrency: String(profile.preferredCurrency || 'USD'),
  };

  if (stayPreferences && typeof stayPreferences === 'object') {
    mergedPrefs.bedType = stayPreferences.bedType || 'King';
    mergedPrefs.pillowType = stayPreferences.pillowType || 'Medium';
    mergedPrefs.floorPreference = stayPreferences.floorPreference || 'Any';
    mergedPrefs.smokingPreference = stayPreferences.smokingPreference || 'Non-Smoking';
    mergedPrefs.roomTemperature = typeof stayPreferences.roomTemperature === 'number'
      ? stayPreferences.roomTemperature : 22;
    mergedPrefs.dietaryPreferences = Array.isArray(stayPreferences.dietaryPreferences)
      ? stayPreferences.dietaryPreferences : [];
    mergedPrefs.allergies = Array.isArray(stayPreferences.allergies)
      ? stayPreferences.allergies : [];
    mergedPrefs.accessibilityNeeds = Array.isArray(stayPreferences.accessibilityNeeds)
      ? stayPreferences.accessibilityNeeds : [];
    // Keep the FO single-string `dietary` key in sync.
    mergedPrefs.dietary = mergedPrefs.dietaryPreferences.length > 0
      ? mergedPrefs.dietaryPreferences.join(', ') : 'None';
  }

  const updateData: Record<string, any> = {
    first_name: firstName,
    last_name: lastName,
    name: `${firstName} ${lastName}`.trim(),
    email: String(profile.email || '').trim() || null,
    phone: String(profile.phone || '').trim() || null,
    nationality: String(profile.nationality || '').trim() || null,
    preferences: mergedPrefs,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error } = await supabaseAdmin
    .from('guests')
    .update(updateData)
    .eq('id', req.params.guestId)
    .select('id, name, first_name, last_name, email, phone, nationality, status, loyalty_points, preferences')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ guestId: updated.id, ...mapGuestProfile(updated) });
});

// ── Guest Settings ─────────────────────────────────────────────────────────
// Portal settings persist under guests.preferences.portalSettings so they
// merge with — never clobber — the FO-managed preference keys the profile
// endpoint writes.

const PORTAL_SETTINGS_DEFAULTS = {
  notifications: { email: true, sms: true, push: true, marketing: false },
  language: 'en' as const,
  theme: 'system' as const,
  privacy: { profileVisibility: 'private' as const, dataSharing: false },
  accessibility: { fontSize: 'medium' as const, highContrast: false, reducedMotion: false },
};

const SETTINGS_LANGUAGES = new Set(['en', 'am', 'ti']);
const SETTINGS_THEMES = new Set(['light', 'dark', 'system']);
const SETTINGS_VISIBILITY = new Set(['public', 'private']);
const SETTINGS_FONT_SIZES = new Set(['small', 'medium', 'large']);

function sanitizePortalSettings(input: any) {
  const src = (input && typeof input === 'object') ? input : {};
  const notif = src.notifications || {};
  const priv = src.privacy || {};
  const acc = src.accessibility || {};
  return {
    notifications: {
      email: !!notif.email,
      sms: !!notif.sms,
      push: !!notif.push,
      marketing: !!notif.marketing,
    },
    language: SETTINGS_LANGUAGES.has(src.language) ? src.language : PORTAL_SETTINGS_DEFAULTS.language,
    theme: SETTINGS_THEMES.has(src.theme) ? src.theme : PORTAL_SETTINGS_DEFAULTS.theme,
    privacy: {
      profileVisibility: SETTINGS_VISIBILITY.has(priv.profileVisibility)
        ? priv.profileVisibility : PORTAL_SETTINGS_DEFAULTS.privacy.profileVisibility,
      dataSharing: !!priv.dataSharing,
    },
    accessibility: {
      fontSize: SETTINGS_FONT_SIZES.has(acc.fontSize)
        ? acc.fontSize : PORTAL_SETTINGS_DEFAULTS.accessibility.fontSize,
      highContrast: !!acc.highContrast,
      reducedMotion: !!acc.reducedMotion,
    },
  };
}

router.get('/settings/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view these settings' });
  }

  const { data: guest, error } = await supabaseAdmin
    .from('guests')
    .select('preferences')
    .eq('id', req.params.guestId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  const stored = (guest.preferences as any)?.portalSettings || {};
  return res.json({ settings: { ...PORTAL_SETTINGS_DEFAULTS, ...sanitizePortalSettings(stored) } });
});

router.put('/settings/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to update these settings' });
  }

  const incoming = req.body?.settings;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'settings object is required' });
  }

  const { data: guest, error: fetchError } = await supabaseAdmin
    .from('guests')
    .select('preferences')
    .eq('id', req.params.guestId)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  const mergedPrefs = {
    ...((guest.preferences || {}) as Record<string, any>),
    portalSettings: sanitizePortalSettings(incoming),
  };

  const { error } = await supabaseAdmin
    .from('guests')
    .update({ preferences: mergedPrefs, updated_at: new Date().toISOString() })
    .eq('id', req.params.guestId);
  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.json({ settings: mergedPrefs.portalSettings });
});

// ── Guest Reservations ──────────────────────────────────────────────────────
// Self-service list/modify/cancel over the shared `reservations` table — the
// same rows the front office manages. Non-staff callers must supply a
// reservationId belonging to the guest (see canActForGuest).
const GUEST_MUTABLE_RESERVATION_STATUSES = new Set(['Reserved', 'Pending', 'Confirmed']);

function mapGuestReservation(r: any, lookups: { properties: Map<string, string>; ratePlans: Map<string, string>; packages: Map<string, string> }) {
  return {
    id: r.id,
    confirmationNumber: r.id,
    hotelName: r.custom_hotel_name || lookups.properties.get(String(r.property_id)) || 'SELEDA Grand Hotel',
    checkInDate: r.check_in_date,
    checkOutDate: r.check_out_date,
    guests: Math.max(1, (r.adults || 0) + (r.children || 0)),
    roomType: r.room_type || '',
    roomNumber: r.room_number || null,
    ratePlan: r.rate_plan_id ? lookups.ratePlans.get(r.rate_plan_id) || null : null,
    packages: (r.package_ids || []).map((pid: string) => lookups.packages.get(pid)).filter(Boolean),
    totalAmount: Number(r.total_amount || 0),
    currency: 'USD',
    paymentStatus: r.payment_status || 'Unpaid',
    status: r.status || 'Reserved',
    channel: r.channel || null,
    createdAt: r.created_at,
  };
}

async function buildReservationLookups(rows: any[]) {
  const propertyIds = [...new Set(rows.map(r => r.property_id).filter(Boolean))];
  const ratePlanIds = [...new Set(rows.map(r => r.rate_plan_id).filter(Boolean))];
  const packageIds = [...new Set(rows.flatMap(r => r.package_ids || []))];

  const [props, plans, pkgs] = await Promise.all([
    propertyIds.length
      ? supabaseAdmin!.from('properties').select('id, property_name').in('id', propertyIds)
      : { data: [] as any[] },
    ratePlanIds.length
      ? supabaseAdmin!.from('rate_plans').select('id, name').in('id', ratePlanIds)
      : { data: [] as any[] },
    packageIds.length
      ? supabaseAdmin!.from('packages').select('id, name').in('id', packageIds)
      : { data: [] as any[] },
  ]);

  return {
    properties: new Map((props.data || []).map(p => [String(p.id), p.property_name])),
    ratePlans: new Map((plans.data || []).map(p => [String(p.id), p.name])),
    packages: new Map((pkgs.data || []).map(p => [String(p.id), p.name])),
  };
}

// List the guest's reservations (upcoming + past)
router.get('/reservations/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  const { data: rows, error } = await supabaseAdmin
    .from('reservations')
    .select('id, property_id, guest_id, check_in_date, check_out_date, adults, children, room_type, room_number, rate, rate_plan_id, package_ids, total_amount, payment_status, status, channel, custom_hotel_name, created_at')
    .eq('guest_id', req.params.guestId)
    .order('check_in_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const lookups = await buildReservationLookups(rows || []);
  return res.json({
    guestId: req.params.guestId,
    reservations: (rows || []).map(r => mapGuestReservation(r, lookups)),
  });
});

// Modify reservation dates (self-service; only before check-in)
router.patch('/reservations/:id', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, guest_name, property_id, status, check_in_date, check_out_date')
    .eq('id', req.params.id)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Reservation not found' });

  if (!(await canActForGuest(req, existing.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to modify this reservation' });
  }
  if (!GUEST_MUTABLE_RESERVATION_STATUSES.has(String(existing.status))) {
    return res.status(409).json({ error: `A ${existing.status} reservation cannot be modified here — please contact the hotel` });
  }

  const { checkInDate, checkOutDate } = req.body || {};
  const checkIn = String(checkInDate || '').slice(0, 10);
  const checkOut = String(checkOutDate || '').slice(0, 10);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) {
    return res.status(400).json({ error: 'checkInDate and checkOutDate (YYYY-MM-DD) are required' });
  }
  if (checkOut <= checkIn) {
    return res.status(400).json({ error: 'Check-out must be after check-in' });
  }

  const { error } = await supabaseAdmin
    .from('reservations')
    .update({ check_in_date: checkIn, check_out_date: checkOut, updated_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  // Flag the change to the front desk — guest date changes bypass rate
  // repricing and availability checks, so staff must review them.
  try {
    await supabaseAdmin.from('guest_requests').insert({
      request_number: `MOD-${Date.now().toString(36).toUpperCase()}`,
      property_id: existing.property_id || null,
      reservation_id: existing.id,
      guest_id: existing.guest_id,
      guest_name: existing.guest_name || 'Guest',
      request_type: 'Reservation Modified',
      description: `Guest changed dates ${existing.check_in_date} → ${existing.check_out_date} to ${checkIn} → ${checkOut}. Review rate and room assignment.`,
      priority: 'Normal',
      status: 'Open',
      assigned_department: 'Front Office',
      submitted_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('reservation-modify FO flag failed:', e?.message);
  }

  await emitGuestNotification({
    guestId: existing.guest_id,
    reservationId: existing.id,
    propertyId: existing.property_id,
    category: 'reservation',
    title: 'Reservation updated',
    message: `Your stay is now ${checkIn} to ${checkOut}. The front desk will review the change.`,
  });

  cacheService.invalidate('guest-*');
  return res.json({ ok: true, id: req.params.id, checkInDate: checkIn, checkOutDate: checkOut });
});

// Cancel a reservation (self-service; only before check-in)
router.patch('/reservations/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, guest_name, property_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Reservation not found' });

  if (!(await canActForGuest(req, existing.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to cancel this reservation' });
  }
  if (!GUEST_MUTABLE_RESERVATION_STATUSES.has(String(existing.status))) {
    return res.status(409).json({ error: `A ${existing.status} reservation cannot be cancelled here — please contact the hotel` });
  }

  const { error } = await supabaseAdmin
    .from('reservations')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  await emitGuestNotification({
    guestId: existing.guest_id,
    reservationId: existing.id,
    propertyId: existing.property_id,
    category: 'reservation',
    title: 'Reservation cancelled',
    message: `Reservation ${existing.id} has been cancelled. Contact the front desk for refunds or rebooking.`,
  });

  cacheService.invalidate('guest-*');
  return res.json({ ok: true, id: req.params.id, status: 'Cancelled' });
});

// ── My Stay Overview ────────────────────────────────────────────────────────
// Composed read for the /guest/my-stay tab: reservation + room + room type +
// property + folio lines + today's itinerary in a single call.
router.get('/my-stay/:reservationId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: reservation, error: resError } = await supabaseAdmin
    .from('reservations')
    .select('id, property_id, guest_id, guest_name, guest_email, room_number, room_type, status, check_in_date, check_out_date, adults, children, rate, payment_status, custom_hotel_name')
    .eq('id', req.params.reservationId)
    .maybeSingle();
  if (resError) return res.status(500).json({ error: resError.message });
  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

  // The path reservationId is the bearer credential on guest surfaces —
  // feed it to canActForGuest, which only inspects body/query.
  const authReq = { ...req, query: { ...req.query, reservationId: req.params.reservationId } };
  if (reservation.guest_id && !(await canActForGuest(authReq, reservation.guest_id))) {
    return res.status(403).json({ error: 'Not authorized to view this stay' });
  }

  // Room + room type (bed config, amenities, size)
  let room: any = null;
  if (reservation.room_number) {
    let q = supabaseAdmin
      .from('rooms')
      .select('id, number, type, floor, features, room_type_id')
      .eq('number', reservation.room_number);
    if (reservation.property_id) q = q.eq('property_id', reservation.property_id);
    const { data: roomRow } = await q.limit(1).maybeSingle();
    if (roomRow) {
      room = {
        number: roomRow.number,
        floor: roomRow.floor,
        features: roomRow.features || [],
      };
      if (roomRow.room_type_id) {
        const { data: rt } = await supabaseAdmin
          .from('room_types')
          .select('name, bed_configuration, amenities, room_size_sqft')
          .eq('id', roomRow.room_type_id)
          .maybeSingle();
        if (rt) {
          room.typeName = rt.name;
          room.bedConfiguration = rt.bed_configuration;
          room.roomSizeSqft = rt.room_size_sqft;
          room.amenities = rt.amenities || [];
        }
      }
    }
  }

  // Property details for the hotel-information card
  let property: any = null;
  if (reservation.property_id) {
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('property_name, address, contact_email, contact_phone, timezone, star_rating, metadata')
      .eq('id', reservation.property_id)
      .maybeSingle();
    if (prop) {
      const meta = (prop.metadata || {}) as Record<string, unknown>;
      property = {
        name: prop.property_name,
        address: prop.address,
        email: prop.contact_email,
        phone: prop.contact_phone,
        timezone: prop.timezone,
        starRating: prop.star_rating,
        checkInTime: typeof meta.check_in_time === 'string' ? meta.check_in_time : '3:00 PM',
        checkOutTime: typeof meta.check_out_time === 'string' ? meta.check_out_time : '11:00 AM',
      };
    }
  }

  // Folio + line items (real folios/folio_lines — not the defunct
  // reservation_folios/folio_charges tables)
  const { data: folio } = await supabaseAdmin
    .from('folios')
    .select('id, folio_number, status, balance, total_charges, total_payments, currency')
    .eq('reservation_id', req.params.reservationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let charges: any[] = [];
  if (folio) {
    const { data: lines } = await supabaseAdmin
      .from('folio_lines')
      .select('id, line_number, transaction_date, description, amount, quantity, line_type, source_module, department')
      .eq('folio_id', folio.id)
      .eq('is_voided', false)
      .order('transaction_date', { ascending: false })
      .order('line_number', { ascending: false })
      .limit(100);
    charges = (lines || []).map(l => ({
      id: l.id,
      description: l.description,
      amount: Number(l.amount || 0),
      quantity: Number(l.quantity || 1),
      date: l.transaction_date,
      category: l.department || l.source_module || l.line_type || 'Other',
    }));
  }

  // Today's itinerary: spa appointments + dining bookings for today
  const today = new Date().toISOString().slice(0, 10);
  const itinerary: any[] = [];
  if (reservation.guest_id) {
    const { data: spa } = await supabaseAdmin
      .from('spa_appointments')
      .select('id, treatment, therapist, start_time, duration_minutes, status')
      .eq('guest_id', reservation.guest_id)
      .eq('appointment_date', today)
      .not('status', 'in', '("Cancelled","No-Show","Completed")');
    for (const a of spa || []) {
      itinerary.push({
        id: `spa-${a.id}`,
        time: a.start_time || '—',
        activity: a.treatment || 'Spa Appointment',
        location: 'Spa',
        description: [a.therapist ? `with ${a.therapist}` : null, a.status].filter(Boolean).join(' · '),
      });
    }
  }
  const dayStart = `${today}T00:00:00.000Z`;
  const dayEnd = `${today}T23:59:59.999Z`;
  const { data: dining } = await supabaseAdmin
    .from('fb_table_reservations')
    .select('id, arrival_time, party_size, status, outlet_id')
    .eq('reservation_id', req.params.reservationId)
    .gte('arrival_time', dayStart)
    .lte('arrival_time', dayEnd)
    .not('status', 'in', '("cancelled","no-show","completed")');
  const outletIds = [...new Set((dining || []).map(d => d.outlet_id).filter(Boolean))];
  const outletNames = new Map<string, string>();
  if (outletIds.length) {
    const { data: outlets } = await supabaseAdmin
      .from('outlets')
      .select('id, name')
      .in('id', outletIds);
    for (const o of outlets || []) outletNames.set(o.id, o.name);
  }
  for (const d of dining || []) {
    itinerary.push({
      id: `dining-${d.id}`,
      time: d.arrival_time ? new Date(d.arrival_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—',
      activity: `Dining Reservation${d.party_size ? ` — ${d.party_size} guest${d.party_size === 1 ? '' : 's'}` : ''}`,
      location: outletNames.get(d.outlet_id) || 'Restaurant',
      description: d.status,
    });
  }
  itinerary.sort((a, b) => String(a.time).localeCompare(String(b.time)));

  return res.json({
    reservation: {
      id: reservation.id,
      guestId: reservation.guest_id,
      guestName: reservation.guest_name,
      status: reservation.status,
      checkInDate: reservation.check_in_date,
      checkOutDate: reservation.check_out_date,
      guests: Math.max(1, (reservation.adults || 0) + (reservation.children || 0)),
      roomNumber: reservation.room_number,
      roomType: reservation.room_type,
      rate: Number(reservation.rate || 0),
      paymentStatus: reservation.payment_status || 'Unpaid',
    },
    room,
    property,
    folio: folio
      ? {
          folioNumber: folio.folio_number,
          status: folio.status,
          balance: Number(folio.balance || 0),
          totalCharges: Number(folio.total_charges || 0),
          totalPayments: Number(folio.total_payments || 0),
          currency: folio.currency || 'USD',
        }
      : null,
    charges,
    itinerary,
  });
});

// ── Loyalty Program Integration ─────────────────────────────────────────────
// Balance lives on guests.loyalty_points (maintained by the
// accrue_loyalty_points/redeem_loyalty_points RPCs); loyalty_transactions is
// the ledger ('accrual' positive / 'redemption' negative).
const LOYALTY_TIERS: { name: string; threshold: number }[] = [
  { name: 'platinum', threshold: 10000 },
  { name: 'gold', threshold: 5000 },
  { name: 'silver', threshold: 2500 },
  { name: 'bronze', threshold: 0 },
];

function calculateLoyaltyTier(points: number): string {
  for (const t of LOYALTY_TIERS) if (points >= t.threshold) return t.name;
  return 'bronze';
}

// Get guest loyalty status: balance, tier, earned/redeemed totals, ledger.
router.get('/loyalty/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name, loyalty_points, created_at')
    .eq('id', req.params.guestId)
    .maybeSingle();
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  const { data: txns, error } = await supabaseAdmin
    .from('loyalty_transactions')
    .select('id, transaction_type, points, balance_after, description, reservation_id, created_at')
    .eq('guest_id', req.params.guestId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  const balance = Number(guest.loyalty_points) || 0;
  const earned = (txns || []).filter(t => t.points > 0).reduce((s, t) => s + t.points, 0);
  const redeemed = (txns || []).filter(t => t.points < 0).reduce((s, t) => s + Math.abs(t.points), 0);
  const tier = calculateLoyaltyTier(balance);
  const tierIdx = LOYALTY_TIERS.findIndex(t => t.name === tier);
  const nextTier = tierIdx > 0 ? LOYALTY_TIERS[tierIdx - 1] : null;

  return res.json({
    guestId: guest.id,
    balance,
    tier,
    memberSince: guest.created_at,
    pointsEarned: earned,
    pointsRedeemed: redeemed,
    nextTier: nextTier ? { name: nextTier.name, threshold: nextTier.threshold } : null,
    transactions: txns || [],
  });
});

// ── Guest Feedback Collection ───────────────────────────────────────────────
// Guest feedback lives in `guest_feedback` (real table). The guest supplies
// guestId + reservationId; property_id is resolved from the reservation
// server-side so the client can't file feedback under the wrong property.

const FEEDBACK_CATEGORIES = new Set([
  'Stay', 'Room', 'Staff', 'Food', 'Cleanliness', 'Facilities',
  'Compliment', 'Suggestion', 'Complaint',
]);

// List the guest's own feedback/reviews.
router.get('/feedback/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this feedback' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_feedback')
    .select('id, reservation_id, category, rating, comments, submitted_at, created_at')
    .eq('guest_id', req.params.guestId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ feedback: data || [] });
});

// Submit feedback
router.post('/feedback', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    reservationId,
    guestId,
    category,
    rating,
    comments,
  } = req.body || {};

  if (!guestId || !reservationId || !category || rating == null) {
    return res.status(400).json({ error: 'guestId, reservationId, category, and rating are required' });
  }
  if (!FEEDBACK_CATEGORIES.has(String(category))) {
    return res.status(400).json({ error: `category must be one of: ${[...FEEDBACK_CATEGORIES].join(', ')}` });
  }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
  }
  if (!comments || !String(comments).trim()) {
    return res.status(400).json({ error: 'comments are required' });
  }

  if (!(await canActForGuest(req, guestId))) {
    return res.status(403).json({ error: 'Not authorized to act for this guest' });
  }

  // Resolve property + verify the reservation belongs to this guest.
  const { data: resv } = await supabaseAdmin
    .from('reservations')
    .select('id, guest_id, property_id')
    .eq('id', reservationId)
    .maybeSingle();
  if (!resv || resv.guest_id !== guestId) {
    return res.status(403).json({ error: 'Reservation not found for this guest' });
  }

  const { data, error } = await supabaseAdmin.from('guest_feedback').insert({
    property_id: resv.property_id,
    reservation_id: resv.id,
    guest_id: guestId,
    category: String(category),
    rating: ratingNum,
    comments: String(comments).trim().slice(0, 2000),
    submitted_by: req.user?.id || guestId,
    submitted_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }).select('id, reservation_id, category, rating, comments, submitted_at, created_at').single();

  if (error) return res.status(500).json({ error: error.message });

  cacheService.invalidate('guest-*');
  return res.status(201).json({ feedback: data });
});

// Get feedback form
// ── Guest Notifications ────────────────────────────────────────────────────
// Guest-facing notification feed backed by guest_notifications (migration
// 653). Rows are emitted by staff-side events — a concierge reply to the
// guest's message, a guest-request status change, or a staff-initiated
// notification via POST /notifications/send below.

const NOTIFICATION_CATEGORIES = new Set([
  'general', 'reservation', 'checkin', 'order', 'transportation',
  'restaurant', 'spa', 'checkout', 'promotion', 'message_reply',
  'request_update',
]);

// Emit a guest notification; never fails the caller's request.
async function emitGuestNotification(input: {
  guestId?: string | null;
  reservationId?: string | null;
  propertyId?: string | null;
  category?: string;
  title: string;
  message: string;
  priority?: 'normal' | 'high';
}): Promise<void> {
  if (!supabaseAdmin || !input.guestId) return;
  const category = NOTIFICATION_CATEGORIES.has(String(input.category)) ? String(input.category) : 'general';
  // Admin-managed override: an active in_app template coded `guest.<category>` rewrites title/message.
  const template = await getNotificationTemplate(`guest.${category}`, 'in_app');
  const vars = { title: input.title, message: input.message };
  const title = template?.subject ? renderTemplate(template.subject, vars) : input.title;
  const message = template ? renderTemplate(template.body, vars) : input.message;
  const { error } = await supabaseAdmin.from('guest_notifications').insert({
    guest_id: input.guestId,
    reservation_id: input.reservationId || null,
    property_id: input.propertyId || null,
    category,
    title: String(title).slice(0, 140),
    message: String(message).slice(0, 500),
    priority: input.priority === 'high' ? 'high' : 'normal',
  });
  if (error) console.warn('emitGuestNotification failed:', error.message);
}

// List the guest's notification feed (newest first, dismissed excluded).
router.get('/notifications/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view these notifications' });
  }

  const { data, error } = await supabaseAdmin
    .from('guest_notifications')
    .select('id, guest_id, reservation_id, category, title, message, priority, read, read_at, created_at')
    .eq('guest_id', req.params.guestId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notifications: data || [] });
});

// Load a notification and check the caller may act for its owner.
async function loadOwnedNotification(req: any, id: string) {
  const { data } = await supabaseAdmin!
    .from('guest_notifications')
    .select('id, guest_id')
    .eq('id', id)
    .maybeSingle();
  if (!data) return { notification: null, authorized: false };
  return { notification: data, authorized: await canActForGuest(req, data.guest_id) };
}

// Mark one notification read.
router.patch('/notifications/:id/read', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { notification, authorized } = await loadOwnedNotification(req, req.params.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  if (!authorized) return res.status(403).json({ error: 'Not authorized' });

  const { error } = await supabaseAdmin
    .from('guest_notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', notification.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Mark all of the guest's notifications read.
router.patch('/notifications/:guestId/read-all', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { error } = await supabaseAdmin
    .from('guest_notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('guest_id', req.params.guestId)
    .eq('read', false)
    .is('dismissed_at', null);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Dismiss a notification (soft-delete — hidden from the feed).
router.delete('/notifications/:id', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { notification, authorized } = await loadOwnedNotification(req, req.params.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found' });
  if (!authorized) return res.status(403).json({ error: 'Not authorized' });

  const { error } = await supabaseAdmin
    .from('guest_notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', notification.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// Staff-initiated notification to a guest — lands in the guest's feed.
router.post('/notifications/send', authenticate, requirePermission('guest:notifications:send'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    propertyId,
    guestId,
    reservationId,
    notificationType,
    title,
    message,
    priority,
  } = req.body || {};

  if (!guestId || !title || !message) {
    return res.status(400).json({ error: 'guestId, title, and message are required' });
  }

  const { data: notification, error } = await supabaseAdmin.from('guest_notifications').insert({
    guest_id: guestId,
    reservation_id: reservationId || null,
    property_id: propertyId || null,
    category: NOTIFICATION_CATEGORIES.has(String(notificationType)) ? notificationType : 'general',
    title: String(title).slice(0, 140),
    message: String(message).slice(0, 500),
    priority: priority === 'high' ? 'high' : 'normal',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ notification });
});

// ── Transportation Booking ─────────────────────────────────────────────────
// Guest-facing transport catalog + bookings. Backed by the property's
// transport_config_items (transport_type) catalog and transport_requests —
// the same tables the staff transportation portal dispatches from.

const TRANSPORT_CAPACITY: Record<string, string> = {
  'Airport Pickup': '4 passengers', 'Airport Drop-off': '4 passengers',
  'City Transfer': '4 passengers', 'Hotel Shuttle': '12 passengers',
  'Sightseeing Tour': '10 passengers', 'VIP Transport': '3 passengers',
  'Staff Shuttle': '12 passengers', 'Courier Service': '—',
};

// Transport service catalog for the guest's property.
router.get('/transport/catalog/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this guest’s catalog' });
  }

  let propId = await guestPropertyId(req.params.guestId);
  if (!propId) {
    const { data: firstProp } = await supabaseAdmin
      .from('properties').select('id').order('created_at').limit(1).maybeSingle();
    propId = firstProp?.id || null;
  }
  if (!propId) return res.json({ services: [] });
  const cacheKey = `transport-catalog:${propId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  const q = supabaseAdmin
    .from('transport_config_items')
    .select('id, name, base_rate, sort_order')
    .eq('item_group', 'transport_type')
    .eq('property_id', propId)
    .eq('active', true);

  const { data, error } = await q.order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const result = {
    services: (data || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      type: s.name,
      capacity: TRANSPORT_CAPACITY[s.name] || '4 passengers',
      pricePerTrip: Number(s.base_rate) || 0,
      description: '',
    })),
  };
  cacheService.set(cacheKey, result, 30 * 60 * 1000);
  return res.json(result);
});

// The guest's own transport bookings.
router.get('/transport/bookings/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this guest’s bookings' });
  }

  const { data, error } = await supabaseAdmin
    .from('transport_requests')
    .select('id, request_number, guest_name, type, source, pickup_location, destination, scheduled_time, passenger_count, status, amount, created_at')
    .eq('guest_id', req.params.guestId)
    .order('scheduled_time', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ bookings: data || [] });
});

// Create a booking — resolves guest identity server-side from guest_id.
router.post('/transport/bookings', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { guest_id, service_id, service_name, date, time,
    pickup_location, dropoff_location, passengers, notes,
    reservation_id, reservationId: reservationIdCamel } = req.body || {};

  if (!guest_id || !date || !time || !pickup_location) {
    return res.status(400).json({ error: 'guest_id, date, time and pickup_location are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || timeToMin(time) === null) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD and time HH:MM' });
  }
  if (date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Cannot book a past date' });
  }
  if (!(await canActForGuest(req, guest_id))) {
    return res.status(403).json({ error: 'Not authorized to book for this guest' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name')
    .eq('id', guest_id)
    .maybeSingle();
  if (!guest) return res.status(400).json({ error: 'Unknown guest' });
  const propId = await guestPropertyId(guest_id);

  // Resolve the service → request type + rate (must be an active catalog item).
  const db = supabaseAdmin;
  let service: any = null;
  const serviceQ = () => db
    .from('transport_config_items')
    .select('id, name, base_rate, active, property_id')
    .eq('item_group', 'transport_type')
    .eq('active', true);
  if (service_id) {
    const { data } = await serviceQ().eq('id', service_id).maybeSingle();
    if (data) service = data;
  }
  if (!service && service_name) {
    const { data } = await serviceQ().eq('name', service_name).limit(1).maybeSingle();
    if (data) service = data;
  }
  if (!service) return res.status(400).json({ error: 'Unknown or unavailable transport service' });

  const requestNumber = `TR-${date.replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  const { data, error } = await supabaseAdmin.from('transport_requests').insert({
    property_id: propId || service.property_id,
    request_number: requestNumber,
    guest_id,
    guest_name: guest.name,
    type: service.name,
    source: 'Guest Mobile App',
    pickup_location: String(pickup_location).slice(0, 300),
    destination: String(dropoff_location || pickup_location).slice(0, 300),
    scheduled_time: new Date(`${date}T${time}:00`).toISOString(),
    passenger_count: Math.max(1, Number(passengers) || 1),
    status: 'Requested',
    special_instructions: notes || null,
    amount: Number(service.base_rate) || 0,
    payment_method: 'Guest Folio',
  }).select('id, request_number, type, scheduled_time, status, amount').single();

  if (error) return res.status(500).json({ error: error.message });

  await emitGuestNotification({
    guestId: guest_id,
    reservationId: reservation_id || reservationIdCamel || null,
    propertyId: propId || service.property_id,
    category: 'transportation',
    title: 'Transportation booked',
    message: `${requestNumber}: ${service.name} on ${date} at ${time} — the transport desk will confirm shortly.`,
  });

  return res.status(201).json({ booking: data });
});

// Guests may cancel only their own Requested/Confirmed bookings.
router.patch('/transport/bookings/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: request } = await supabaseAdmin
    .from('transport_requests')
    .select('id, guest_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!request) return res.status(404).json({ error: 'Booking not found' });
  if (!(await canActForGuest(req, request.guest_id))) {
    return res.status(403).json({ error: 'You can only cancel your own bookings' });
  }
  if (!['Requested', 'Confirmed'].includes(request.status)) {
    return res.status(409).json({ error: `Cannot cancel a booking that is ${request.status}` });
  }

  const { data, error } = await supabaseAdmin
    .from('transport_requests')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await runTransportStatusSideEffects(data, request.status);
  return res.json({ booking: data });
});

// ── Meeting & Banquet Services ───────────────────────────────────────────────
// Venues come from `banquet_venues`; guest inquiries create `banquet_events`
// rows (client_id = guest id, status 'Inquiry') — the same entities the staff
// events/banquet portal works from.
const EVENT_TYPES_ALLOWED = [
  'Meeting', 'Conference', 'CorporateEvent', 'Banquet', 'Wedding',
  'Birthday', 'Anniversary', 'CocktailReception', 'GalaDinner',
  'Exhibition', 'ProductLaunch', 'Graduation', 'ReligiousEvent', 'Other',
];

router.get('/meetings/overview/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view these events' });
  }

  let propId = await guestPropertyId(req.params.guestId);
  if (!propId) {
    const { data: firstProp } = await supabaseAdmin
      .from('properties').select('id').order('created_at').limit(1).maybeSingle();
    propId = firstProp?.id || null;
  }

  const venueQ = supabaseAdmin
    .from('banquet_venues')
    .select('id, venue_name, venue_type, capacity, area, floor, features, layouts, hourly_rate, daily_rate')
    .eq('is_active', true)
    .order('capacity', { ascending: true });
  if (propId) venueQ.eq('property_id', propId);

  const [venuesRes, eventsRes] = await Promise.all([
    venueQ,
    supabaseAdmin
      .from('banquet_events')
      .select('id, event_name, event_type, event_date, end_date, guest_count, expected_attendees, venue_ids, status, notes, created_at')
      .eq('client_id', req.params.guestId)
      .order('event_date', { ascending: false })
      .limit(50),
  ]);

  if (venuesRes.error) return res.status(500).json({ error: venuesRes.error.message });
  if (eventsRes.error) return res.status(500).json({ error: eventsRes.error.message });
  return res.json({ venues: venuesRes.data || [], events: eventsRes.data || [] });
});

// Submit a meeting/banquet inquiry — creates a banquet_events row staff review.
router.post('/meetings/inquiries', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const {
    guest_id, reservation_id, venue_id, event_type, event_name,
    date, time, guests, requirements,
  } = req.body || {};

  if (!guest_id || !event_type || !date || !guests) {
    return res.status(400).json({ error: 'guest_id, event_type, date and guests are required' });
  }
  if (!EVENT_TYPES_ALLOWED.includes(event_type)) {
    return res.status(400).json({ error: 'Unknown event type' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD and not in the past' });
  }
  if (!(await canActForGuest(req, guest_id))) {
    return res.status(403).json({ error: 'Not authorized to inquire for this guest' });
  }

  const { data: guest } = await supabaseAdmin
    .from('guests')
    .select('id, name, email, phone')
    .eq('id', guest_id)
    .maybeSingle();
  if (!guest) return res.status(400).json({ error: 'Unknown guest' });
  const propId = await guestPropertyId(guest_id);

  // Optional venue preference — must be an active venue.
  let venueIds: string[] | null = null;
  if (venue_id) {
    const { data: venue } = await supabaseAdmin
      .from('banquet_venues')
      .select('id')
      .eq('id', venue_id)
      .eq('is_active', true)
      .maybeSingle();
    if (venue) venueIds = [venue.id];
  }

  const notes = [
    time ? `Preferred time: ${String(time).slice(0, 5)}` : null,
    requirements ? String(requirements).slice(0, 1500) : null,
    reservation_id ? `Linked reservation: ${reservation_id}` : null,
  ].filter(Boolean).join(' | ') || null;

  const { data, error } = await supabaseAdmin.from('banquet_events').insert({
    id: crypto.randomUUID(),
    property_id: propId,
    event_name: String(event_name || `${event_type} inquiry`).slice(0, 200),
    event_type,
    event_date: date,
    client_id: guest.id,
    client_name: guest.name,
    organizer_name: guest.name,
    guest_count: Math.max(1, Number(guests) || 1),
    expected_attendees: Math.max(1, Number(guests) || 1),
    venue_ids: venueIds,
    notes,
    status: 'Inquiry',
    created_by: req.user?.id || null,
  }).select('id, event_name, event_type, event_date, status').single();

  if (error) return res.status(500).json({ error: error.message });

  await emitGuestNotification({
    guestId: guest.id,
    reservationId: reservation_id || null,
    propertyId: propId,
    category: 'general',
    title: 'Event inquiry received',
    message: `${data?.event_name || 'Your event'} for ${date} is with our events team — they'll follow up with a proposal.`,
  });

  cacheService.invalidate('guest-*');
  cacheService.invalidate('be-*');
  return res.status(201).json({ event: data });
});

// Guests may withdraw their own unconfirmed inquiries.
router.patch('/meetings/events/:id/cancel', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: existing } = await supabaseAdmin
    .from('banquet_events')
    .select('id, client_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (!existing.client_id || !(await canActForGuest(req, existing.client_id))) {
    return res.status(403).json({ error: 'Not authorized to cancel this event' });
  }
  if (!['Inquiry', 'Tentative', 'Planning'].includes(existing.status)) {
    return res.status(409).json({ error: `Cannot cancel an event that is ${existing.status}` });
  }

  const { data, error } = await supabaseAdmin
    .from('banquet_events')
    .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('id, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('guest-*');
  cacheService.invalidate('be-*');
  return res.json({ event: data });
});

// ── Wallet & Payments ────────────────────────────────────────────────────────
// Payment methods: `guest_payment_methods` (metadata-only card-on-file
// references — never PAN/CVV). Payment history: `folio_payments` across the
// guest's reservations.
const WALLET_METHOD_TYPES = [
  'CreditCard', 'DebitCard', 'MobileWallet', 'BankTransfer', 'CorporateAccount', 'GiftCard',
];

router.get('/wallet/:guestId', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized to view this wallet' });
  }

  const [methodsRes, resvRes] = await Promise.all([
    supabaseAdmin
      .from('guest_payment_methods')
      .select('id, method_type, label, last_four, expiry, is_default, created_at')
      .eq('guest_id', req.params.guestId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('reservations')
      .select('id')
      .eq('guest_id', req.params.guestId)
      .limit(200),
  ]);

  if (methodsRes.error) return res.status(500).json({ error: methodsRes.error.message });
  if (resvRes.error) return res.status(500).json({ error: resvRes.error.message });

  const resvIds = (resvRes.data || []).map((r: any) => r.id);
  let payments: any[] = [];
  if (resvIds.length) {
    const { data, error } = await supabaseAdmin
      .from('folio_payments')
      .select('id, reservation_id, payment_date, amount, payment_method, payment_sub_type, card_last_four, reference_number, is_refund, is_voided')
      .in('reservation_id', resvIds)
      .order('payment_date', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    payments = data || [];
  }

  return res.json({
    methods: (methodsRes.data || []).map((m: any) => ({
      id: m.id,
      type: m.method_type,
      name: m.label,
      lastFour: m.last_four,
      expiryDate: m.expiry,
      isDefault: m.is_default,
    })),
    payments: payments.map((p: any) => ({
      id: p.id,
      amount: Number(p.amount) || 0,
      date: p.payment_date,
      description: [p.payment_method, p.payment_sub_type].filter(Boolean).join(' — ') || 'Payment',
      method: p.card_last_four ? `${p.payment_method} •••• ${p.card_last_four}` : p.payment_method,
      reference: p.reference_number,
      status: p.is_voided ? 'Refunded' : p.is_refund ? 'Refunded' : 'Completed',
    })),
  });
});

// Save a card-on-file reference (display metadata only — never PAN/CVV).
router.post('/wallet/:guestId/methods', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  if (!(await canActForGuest(req, req.params.guestId))) {
    return res.status(403).json({ error: 'Not authorized for this guest' });
  }

  const { method_type, label, last_four, expiry } = req.body || {};
  if (!method_type || !label) {
    return res.status(400).json({ error: 'method_type and label are required' });
  }
  if (!WALLET_METHOD_TYPES.includes(method_type)) {
    return res.status(400).json({ error: 'Unknown payment method type' });
  }
  if (last_four && !/^\d{4}$/.test(String(last_four))) {
    return res.status(400).json({ error: 'last_four must be exactly 4 digits' });
  }

  // First saved method becomes the default automatically.
  const { count } = await supabaseAdmin
    .from('guest_payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('guest_id', req.params.guestId);

  const { data, error } = await supabaseAdmin.from('guest_payment_methods').insert({
    id: crypto.randomUUID(),
    guest_id: req.params.guestId,
    method_type,
    label: String(label).slice(0, 100),
    last_four: last_four ? String(last_four) : null,
    expiry: expiry ? String(expiry).slice(0, 10) : null,
    is_default: !count,
  }).select('id, method_type, label, last_four, expiry, is_default').single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('guest-*');
  return res.status(201).json({ method: data });
});

// Set a method as the default (clears the others).
router.patch('/wallet/methods/:id/default', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: method } = await supabaseAdmin
    .from('guest_payment_methods')
    .select('id, guest_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!method) return res.status(404).json({ error: 'Payment method not found' });
  if (!(await canActForGuest(req, method.guest_id))) {
    return res.status(403).json({ error: 'Not authorized for this guest' });
  }

  await supabaseAdmin
    .from('guest_payment_methods')
    .update({ is_default: false })
    .eq('guest_id', method.guest_id);
  const { data, error } = await supabaseAdmin
    .from('guest_payment_methods')
    .update({ is_default: true })
    .eq('id', method.id)
    .select('id, is_default')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  cacheService.invalidate('guest-*');
  return res.json({ method: data });
});

// Remove a saved method. If it was the default, promote the oldest remaining.
router.delete('/wallet/methods/:id', authenticateGuestOrStaff, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);

  const { data: method } = await supabaseAdmin
    .from('guest_payment_methods')
    .select('id, guest_id, is_default')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!method) return res.status(404).json({ error: 'Payment method not found' });
  if (!(await canActForGuest(req, method.guest_id))) {
    return res.status(403).json({ error: 'Not authorized for this guest' });
  }

  const { error } = await supabaseAdmin
    .from('guest_payment_methods')
    .delete()
    .eq('id', method.id);
  if (error) return res.status(500).json({ error: error.message });

  if (method.is_default) {
    const { data: next } = await supabaseAdmin
      .from('guest_payment_methods')
      .select('id')
      .eq('guest_id', method.guest_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabaseAdmin
        .from('guest_payment_methods')
        .update({ is_default: true })
        .eq('id', next.id);
    }
  }

  cacheService.invalidate('guest-*');
  return res.json({ ok: true });
});

export default router;
