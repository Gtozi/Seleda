-- =============================================================================
-- Migration 457: Banquet & Events — add updated_at to tables missing it
-- =============================================================================
-- banquet_communications (449) and the guest-experience tables (450) were
-- created without updated_at, so edits can't be tracked and the generic
-- PUT routes in banquetEvents.routes.ts would fail on these tables.
-- Also adds the standard update_updated_at_column() triggers used by the
-- other banquet tables (455).
-- =============================================================================

ALTER TABLE public.banquet_communications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.banquet_event_guests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.banquet_event_registrations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.banquet_event_seating
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- updated_at triggers (function exists since baseline)
DROP TRIGGER IF EXISTS trg_banquet_communications_updated_at ON public.banquet_communications;
CREATE TRIGGER trg_banquet_communications_updated_at
  BEFORE UPDATE ON public.banquet_communications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_event_guests_updated_at ON public.banquet_event_guests;
CREATE TRIGGER trg_banquet_event_guests_updated_at
  BEFORE UPDATE ON public.banquet_event_guests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_event_registrations_updated_at ON public.banquet_event_registrations;
CREATE TRIGGER trg_banquet_event_registrations_updated_at
  BEFORE UPDATE ON public.banquet_event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_event_seating_updated_at ON public.banquet_event_seating;
CREATE TRIGGER trg_banquet_event_seating_updated_at
  BEFORE UPDATE ON public.banquet_event_seating
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
