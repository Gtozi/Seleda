-- =============================================================================
-- Migration 460: Banquet & Events — Registration check-in
-- =============================================================================
-- GAP: the spec's Registration Management module (§22) calls for QR-code
-- check-in, attendance tracking and walk-in registration, but
-- banquet_event_registrations (450) only stored name / org / payment flag.
--
-- Adds:
--   registration_code  — unique per-registration code (REG-XXXXXXXX). This is
--                        what gets encoded into a QR/badge; the check-in
--                        endpoints resolve a code to a registration.
--   checked_in / checked_in_at / checked_in_by — attendance tracking.
--   is_walk_in         — marks registrations created at the door.
--
-- Depends on: 450 (banquet_event_registrations), 457 (updated_at)
-- =============================================================================

ALTER TABLE public.banquet_event_registrations
  ADD COLUMN IF NOT EXISTS registration_code text,
  ADD COLUMN IF NOT EXISTS checked_in       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at    timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by    text,
  ADD COLUMN IF NOT EXISTS is_walk_in       boolean NOT NULL DEFAULT false;

-- Backfill a code for every existing registration.
UPDATE public.banquet_event_registrations
SET registration_code = 'REG-' || upper(substr(replace(id, '-', ''), 1, 8))
WHERE registration_code IS NULL;

-- Codes are the scan target — they must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_banquet_registrations_code
  ON public.banquet_event_registrations (registration_code)
  WHERE registration_code IS NOT NULL;

-- Attendance counting by event is the hot read for the check-in list.
CREATE INDEX IF NOT EXISTS idx_banquet_registrations_event_checkedin
  ON public.banquet_event_registrations (event_id, checked_in);

COMMENT ON COLUMN public.banquet_event_registrations.registration_code IS
  'Unique check-in code printed on the badge / encoded in the QR. '
  'Generated server-side on insert; resolved by PUT /registrations/check-in-by-code.';
COMMENT ON COLUMN public.banquet_event_registrations.is_walk_in IS
  'True for attendees registered at the door rather than pre-registered.';
