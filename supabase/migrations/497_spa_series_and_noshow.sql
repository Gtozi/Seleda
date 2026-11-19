-- =============================================================================
-- 497_spa_series_and_noshow.sql
--   1. spa_appointment_series + spa_appointments.series_id — recurring/series
--      bookings (e.g. weekly massage for 6 weeks) tracked as one series with
--      per-instance conflict checks.
--   2. No-show fee support: configurable charge created automatically when an
--      appointment transitions to 'No Show' (spa_settings key
--      'no_show_fee_percent', default 50).
-- =============================================================================

-- ── 1. Series bookings ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_appointment_series (
  id             text PRIMARY KEY,
  guest_id       text REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_name     text NOT NULL,
  treatment_id   text REFERENCES public.spa_treatments(id) ON DELETE SET NULL,
  treatment      text NOT NULL,
  therapist_id   text REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  room_id        text REFERENCES public.spa_rooms(id) ON DELETE SET NULL,
  frequency      text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
  start_date     date NOT NULL,
  start_time     text NOT NULL,
  duration_minutes integer NOT NULL,
  occurrences    integer NOT NULL CHECK (occurrences BETWEEN 2 AND 52),
  status         text NOT NULL DEFAULT 'Active'
                 CHECK (status IN ('Active','Completed','Cancelled')),
  notes          text,
  property_id    uuid REFERENCES public.properties(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_appointment_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_appointment_series_all ON public.spa_appointment_series;
CREATE POLICY spa_appointment_series_all ON public.spa_appointment_series
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_appointment_series TO authenticated;

ALTER TABLE public.spa_appointments
  ADD COLUMN IF NOT EXISTS series_id text REFERENCES public.spa_appointment_series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spa_appointments_series ON public.spa_appointments(series_id)
  WHERE series_id IS NOT NULL;

-- Counter for SRS- ids.
INSERT INTO public.spa_id_counters (prefix, value)
VALUES ('SRS-', 0)
ON CONFLICT (prefix) DO NOTHING;

-- ── 2. No-show fee setting ─────────────────────────────────────────────────
-- Read by the PATCH /appointments 'No Show' path; percent of the appointment
-- amount charged as a Pending transaction. 0 disables the fee.

INSERT INTO public.spa_settings (id, section, name, description, value, status)
SELECT 'SET-NOSHOW-FEE', 'general', 'No-Show Fee Percent',
       'Percentage of the appointment amount charged when a guest is marked No Show (0 disables)',
       '{"percent": 50}'::jsonb, 'Configured'
WHERE NOT EXISTS (
  SELECT 1 FROM public.spa_settings WHERE name = 'No-Show Fee Percent'
);
