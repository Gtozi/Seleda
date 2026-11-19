-- 595_concierge_portal_gap_fixes.sql
-- Closes schema gaps found in the Concierge portal end-to-end review:
--   1. guest_communications had RLS policies (baseline) and a seed (589) but
--      no CREATE TABLE anywhere.
--   2. guest_requests.rating / .feedback are written by PUT
--      /api/concierge/requests/:id and read by /dashboard/kpi and the
--      guest-satisfaction report, but no migration added the columns.

-- ── guest_communications ──────────────────────────────────────────────────
-- Columns match the 589 seed and the /api/concierge/communications handlers.
CREATE TABLE IF NOT EXISTS public.guest_communications (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  guest_id       text,
  reservation_id text,
  room_number    text,
  message        text NOT NULL,
  message_type   text NOT NULL DEFAULT 'Inquiry'
                 CHECK (message_type IN ('Request','Booking','Inquiry','Complaint','Other')),
  status         text NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending','In Progress','Resolved')),
  reply          text,
  replied_by     text,
  replied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_communications_guest
  ON public.guest_communications(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_communications_reservation
  ON public.guest_communications(reservation_id);
CREATE INDEX IF NOT EXISTS idx_guest_communications_status
  ON public.guest_communications(status);

-- Heal deployments where the table was created by hand before this migration:
-- inserts from the staff reply path, the guest portal, and the wake-up
-- dispatcher all rely on the id default.
ALTER TABLE public.guest_communications
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE public.guest_communications ENABLE ROW LEVEL SECURITY;

-- Mirrors the baseline intent: guests may submit messages, staff use the
-- service role / authenticated full-DML grant from the baseline.
DROP POLICY IF EXISTS "anon_insert_guest_communications" ON public.guest_communications;
CREATE POLICY "anon_insert_guest_communications" ON public.guest_communications
  FOR INSERT TO anon WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_communications TO authenticated;
GRANT INSERT ON public.guest_communications TO anon;

-- ── guest_requests satisfaction fields ────────────────────────────────────
ALTER TABLE public.guest_requests
  ADD COLUMN IF NOT EXISTS rating integer
    CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  ADD COLUMN IF NOT EXISTS feedback text;
