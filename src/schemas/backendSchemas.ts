import { z } from 'zod';
import { idSchema, dateSchema, emailSchema, phoneSchema } from './common';

// Room validation (backend API)
export const roomApiSchema = z.object({
  id: idSchema.optional(),
  number: z.string().min(1, 'Room number is required'),
  room_type_id: idSchema,
  status: z.enum(['Vacant Clean', 'Vacant Dirty', 'Occupied', 'Out of Order', 'Maintenance']).default('Vacant Clean'),
  floor: z.coerce.number().int().optional(),
  notes: z.string().optional(),
});

export type RoomApiInput = z.infer<typeof roomApiSchema>;

// Guest validation (backend API)
export const guestApiSchema = z.object({
  id: idSchema.optional(),
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  nationality: z.string().optional(),
  id_type: z.string().optional(),
  id_number: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  notes: z.string().optional(),
});

export type GuestApiInput = z.infer<typeof guestApiSchema>;

// Reservation validation (backend API)
// NOTE: this schema is used by `PUT /api/reservations/:id`, which is the
// primary persistence path called from ReservationContext (addReservation /
// updateReservation) via supabaseService.upsertReservation(). zod's default
// z.object() *silently strips* any key not declared below — so every field
// the billing/folio system depends on (billing_mode, corporate_account_id,
// booking_group_id, booking_type, discount_percent, ...) must be listed here
// as optional, or it will never actually reach the database even though the
// frontend appears to save it successfully. room_type_id was previously
// required, which made validation fail (and therefore silently drop the
// entire update — see upsertReservation's catch-and-warn) for any reservation
// created without an explicit room_type_id FK (the common case, since the
// booking form only sets the free-text room_type).
export const reservationApiSchema = z.object({
  id: idSchema.optional(),
  guest_id: idSchema.optional(),
  room_type_id: idSchema.optional(),
  room_type: z.string().optional(),
  room_number: z.string().optional(),
  check_in_date: dateSchema,
  check_out_date: dateSchema,
  status: z.enum(['Pending', 'Confirmed', 'CheckedIn', 'CheckedOut', 'Cancelled', 'NoShow', 'Waitlisted']).default('Pending'),
  channel: z.enum(['Direct', 'OTA', 'Corporate', 'Group', 'Direct Website']).default('Direct'),
  source: z.string().optional(),
  adult_count: z.coerce.number().int().min(1).default(1),
  child_count: z.coerce.number().int().min(0).default(0),
  base_rate: z.coerce.number().min(0).optional(),
  total_amount: z.coerce.number().min(0).optional(),
  deposit_amount: z.coerce.number().min(0).optional(),
  payment_status: z.enum(['Unpaid', 'Partial', 'Paid', 'Refunded']).default('Unpaid'),
  special_requests: z.string().optional(),
  notes: z.string().optional(),
  created_by: idSchema.optional(),
  // ── Billing / folio-routing fields ──────────────────────────────────
  // Kept in sync with mapReservationToDb() in src/services/dataMapper.ts.
  billing_mode: z.enum(['individual', 'group', 'corporate']).optional(),
  corporate_account_id: z.string().optional().nullable(),
  booking_group_id: z.string().optional().nullable(),
  booking_type: z.enum(['Individual', 'Group', 'Corporate']).optional(),
  discount_percent: z.coerce.number().min(0).max(100).optional(),
}).passthrough().refine((data) => {
  const start = new Date(data.check_in_date);
  const end = new Date(data.check_out_date);
  return end > start;
}, {
  message: "Check-out date must be after check-in date",
  path: ["check_out_date"],
});

export type ReservationApiInput = z.infer<typeof reservationApiSchema>;

// Room Type validation (backend API)
export const roomTypeApiSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1, 'Room type name is required'),
  description: z.string().optional(),
  base_price: z.coerce.number().min(0),
  max_occupancy: z.coerce.number().int().min(1),
  bed_configuration: z.string().optional(),
  room_size_sqm: z.coerce.number().min(0).optional(),
  amenities: z.array(z.string()).optional(),
  image_url_1: z.string().url().optional().or(z.literal('')),
  image_url_2: z.string().url().optional().or(z.literal('')),
  image_url_3: z.string().url().optional().or(z.literal('')),
  is_active: z.boolean().default(true),
  display_order: z.coerce.number().int().default(0),
});

export type RoomTypeApiInput = z.infer<typeof roomTypeApiSchema>;

// Rate Plan validation (backend API)
export const ratePlanApiSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1, 'Rate plan name is required'),
  description: z.string().optional(),
  base_modifier: z.coerce.number().min(0).default(1),
  min_stay: z.coerce.number().int().min(1).default(1),
  max_stay: z.coerce.number().int().optional(),
  cancellation_policy: z.string().optional(),
  active: z.boolean().default(true),
});

export type RatePlanApiInput = z.infer<typeof ratePlanApiSchema>;

// Season validation (backend API)
export const seasonApiSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1, 'Season name is required'),
  start_date: dateSchema,
  end_date: dateSchema,
  multiplier: z.coerce.number().min(0).default(1),
  is_active: z.boolean().default(true),
}).refine((data) => {
  const start = new Date(data.start_date);
  const end = new Date(data.end_date);
  return end > start;
}, {
  message: "End date must be after start date",
  path: ["end_date"],
});

export type SeasonApiInput = z.infer<typeof seasonApiSchema>;

// Package validation (backend API)
export const packageApiSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1, 'Package name is required'),
  description: z.string().optional(),
  price: z.coerce.number().min(0),
  charge_frequency: z.enum(['once', 'per_night', 'per_stay']).default('once'),
  is_active: z.boolean().default(true),
});

export type PackageApiInput = z.infer<typeof packageApiSchema>;

// Yield Policy validation (backend API)
export const yieldPolicyApiSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1, 'Policy name is required'),
  room_type_id: idSchema,
  min_occupancy_threshold: z.coerce.number().int().min(0).default(0),
  max_occupancy_threshold: z.coerce.number().int().min(0).default(100),
  rate_modifier: z.coerce.number().default(1),
  is_active: z.boolean().default(true),
});

export type YieldPolicyApiInput = z.infer<typeof yieldPolicyApiSchema>;

// Airport Shuttle Request validation (backend API)
// Matches the real airport_shuttle_requests columns (migration 040/041/523).
export const airportShuttleApiSchema = z.object({
  id: z.string().optional(),
  guest_id: z.string().optional(),
  guest_name: z.string().optional(),
  reservation_id: z.string().optional(),
  room_number: z.string().nullable().optional(),
  scheduled_date: z.string().min(1, 'Scheduled date is required'),
  scheduled_time: z.string().min(1, 'Scheduled time is required'),
  shuttle_type: z.enum(['Pickup', 'Drop-off']),
  flight_number: z.string().optional(),
  flight_time: z.string().nullable().optional(),
  pickup_location: z.string().optional(),
  dropoff_location: z.string().optional(),
  status: z.enum(['Pending', 'Confirmed', 'Completed', 'Cancelled']).default('Pending'),
  notes: z.string().optional(),
  quantity: z.coerce.number().int().min(1).optional(),
});

export type AirportShuttleApiInput = z.infer<typeof airportShuttleApiSchema>;
