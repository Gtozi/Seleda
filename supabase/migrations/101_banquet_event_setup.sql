-- Banquet & Events event-setup support: venues table and additional event fields

CREATE TABLE IF NOT EXISTS public.banquet_venues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  venue_name text NOT NULL,
  venue_type text,
  capacity integer DEFAULT 0,
  area integer DEFAULT 0,
  floor text,
  features text[] DEFAULT '{}'::text[],
  layouts text[] DEFAULT '{}'::text[],
  hourly_rate numeric DEFAULT 0,
  daily_rate numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_venues_property ON public.banquet_venues(property_id);

ALTER TABLE public.banquet_events
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS organizer_name text,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS package_id text,
  ADD COLUMN IF NOT EXISTS venue_ids text[] DEFAULT '{}'::text[];

ALTER TABLE public.banquet_events
  DROP CONSTRAINT IF EXISTS banquet_events_status_check;

ALTER TABLE public.banquet_events
  ADD CONSTRAINT banquet_events_status_check
  CHECK (status = ANY (ARRAY['Tentative','Draft','Confirmed','Planning','InProgress','Completed','Cancelled']));