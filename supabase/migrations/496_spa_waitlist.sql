-- =============================================================================
-- 496_spa_waitlist.sql
-- Waitlist for fully-booked slots: guests/staff register interest for a
-- treatment on a date; when an appointment on that date is cancelled the
-- matching waitlist rows are flagged 'Notified' for staff follow-up.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.spa_waitlist (
  id               text PRIMARY KEY,
  guest_id         text REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_name       text NOT NULL,
  contact          text,                        -- phone/email for follow-up
  treatment_id     text REFERENCES public.spa_treatments(id) ON DELETE SET NULL,
  treatment        text NOT NULL,
  therapist_id     text REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  preferred_date   date NOT NULL,
  preferred_time   text,                        -- optional HH:MM preference
  status           text NOT NULL DEFAULT 'Waiting'
                   CHECK (status IN ('Waiting','Notified','Booked','Cancelled','Expired')),
  booked_appointment_id text REFERENCES public.spa_appointments(id) ON DELETE SET NULL,
  notes            text,
  property_id      uuid REFERENCES public.properties(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spa_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_waitlist_all ON public.spa_waitlist;
CREATE POLICY spa_waitlist_all ON public.spa_waitlist
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_waitlist TO authenticated;

CREATE INDEX IF NOT EXISTS idx_spa_waitlist_date ON public.spa_waitlist(preferred_date, status);
CREATE INDEX IF NOT EXISTS idx_spa_waitlist_guest ON public.spa_waitlist(guest_id);

-- Counter for WLT- ids.
INSERT INTO public.spa_id_counters (prefix, value)
VALUES ('WLT-', 0)
ON CONFLICT (prefix) DO NOTHING;
