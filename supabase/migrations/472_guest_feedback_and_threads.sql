-- =============================================================================
-- Migration 472: Banquet & Events — per-guest feedback + communication threads
-- =============================================================================
-- GAP: Guest Feedback (§Guest Experience) was a single satisfaction_score +
-- free-text feedback blob on event_bookings — no per-guest responses, no
-- complaint categories, no follow-up tracking. Communications were flat rows
-- with no reply threading.
--
-- Adds:
--   banquet_event_feedback — per-guest survey/complaint rows with a category
--     (Food | Service | Venue | AV | Billing | Other) and a resolved flag.
--   banquet_communications.parent_id — reply threading for in-app messages.
--
-- Depends on: 444 (event_bookings), 450 (banquet_event_guests),
--             449 (banquet_communications), 458 (RLS helper)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_event_feedback (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id    text NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  guest_id    text REFERENCES public.banquet_event_guests(id) ON DELETE SET NULL,
  guest_name  text,
  rating      integer CHECK (rating BETWEEN 1 AND 5),
  category    text NOT NULL DEFAULT 'General',
  comments    text,
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_feedback_event
  ON public.banquet_event_feedback (event_id);

ALTER TABLE public.banquet_event_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_event_feedback_property_scoped ON public.banquet_event_feedback;
CREATE POLICY banquet_event_feedback_property_scoped ON public.banquet_event_feedback
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_event_feedback_updated_at ON public.banquet_event_feedback;
CREATE TRIGGER trg_event_feedback_updated_at
  BEFORE UPDATE ON public.banquet_event_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reply threading on communications.
ALTER TABLE public.banquet_communications
  ADD COLUMN IF NOT EXISTS parent_id text REFERENCES public.banquet_communications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_banquet_communications_parent
  ON public.banquet_communications (parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON TABLE public.banquet_event_feedback IS
  'Per-guest survey/complaint rows for an event. Backs the Guest Experience '
  'feedback panel; event_bookings.satisfaction_score remains the rollup.';
