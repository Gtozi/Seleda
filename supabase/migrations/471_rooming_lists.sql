-- =============================================================================
-- Migration 471: Banquet & Events — rooming lists
-- =============================================================================
-- GAP: Room Blocks (§Rooming Lists, line 314) — events with room blocks need
-- a per-guest rooming list (who arrives when, which room type, special
-- requests) to hand to Front Office. banquet_event_guests tracks invitees,
-- not room assignments, and group_blocks/room allocations live in PMS.
--
-- Adds banquet_rooming_list: one row per room occupant for an event,
-- optionally linked to a banquet guest.
--
-- Depends on: 444 (event_bookings), 450 (banquet_event_guests), 458 (RLS)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_rooming_list (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id      uuid,
  event_id         text NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  guest_id         text REFERENCES public.banquet_event_guests(id) ON DELETE SET NULL,
  guest_name       text NOT NULL,
  room_type        text,
  check_in         date,
  check_out        date,
  special_requests text,
  status           text NOT NULL DEFAULT 'Pending',   -- Pending | Submitted | Confirmed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooming_list_event
  ON public.banquet_rooming_list (event_id);

ALTER TABLE public.banquet_rooming_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_rooming_list_property_scoped ON public.banquet_rooming_list;
CREATE POLICY banquet_rooming_list_property_scoped ON public.banquet_rooming_list
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_rooming_list_updated_at ON public.banquet_rooming_list;
CREATE TRIGGER trg_rooming_list_updated_at
  BEFORE UPDATE ON public.banquet_rooming_list
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.banquet_rooming_list IS
  'Per-event rooming list handed to Front Office for room-block events. '
  'Backs /api/banquet-events/rooming-list endpoints.';
