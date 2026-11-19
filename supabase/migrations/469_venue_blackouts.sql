-- =============================================================================
-- Migration 469: Banquet & Events — venue blackout / maintenance windows
-- =============================================================================
-- GAP: Venue Management in the spec includes taking a function space out of
-- service (maintenance, renovations, private holds) — banquet_venues only
-- had an is_active flag, so there was no way to block a date range.
--
-- Adds banquet_venue_blackouts: dated out-of-service windows per venue.
-- Enforcement happens in the booking routes (POST /events,
-- PUT /events/:id/status -> Confirmed) which reject bookings whose venue is
-- blacked out over the event dates — same pattern as the venue-conflict gate
-- inside advance_event_status.
--
-- Depends on: 101 (banquet_venues), 458 (RLS helper)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_venue_blackouts (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  venue_id    text NOT NULL REFERENCES public.banquet_venues(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_venue_blackouts_venue_dates
  ON public.banquet_venue_blackouts (venue_id, start_date, end_date);

ALTER TABLE public.banquet_venue_blackouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_venue_blackouts_property_scoped ON public.banquet_venue_blackouts;
CREATE POLICY banquet_venue_blackouts_property_scoped ON public.banquet_venue_blackouts
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_venue_blackouts_updated_at ON public.banquet_venue_blackouts;
CREATE TRIGGER trg_venue_blackouts_updated_at
  BEFORE UPDATE ON public.banquet_venue_blackouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.banquet_venue_blackouts IS
  'Out-of-service windows per venue (maintenance, private holds). Booking '
  'routes reject events that overlap a blackout on any of their venues.';
