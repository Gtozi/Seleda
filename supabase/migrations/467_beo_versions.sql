-- =============================================================================
-- Migration 467: Banquet & Events — BEO revision history
-- =============================================================================
-- GAP: BEO lifecycle includes a 'Revised' status, but every UPDATE overwrote
-- the row — once a BEO was revised there was no record of what the kitchen
-- and departments had originally been told.
--
-- Adds banquet_beo_versions: an append-only snapshot of the previous row on
-- every UPDATE to banquet_beos (created via trigger, so the PUT /beos/:id
-- and distribute paths are both covered without route changes).
--
-- Depends on: 103/444 (banquet_beos), 458 (RLS helper)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_beo_versions (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  beo_id      text NOT NULL REFERENCES public.banquet_beos(id) ON DELETE CASCADE,
  event_id    text,
  version_no  integer NOT NULL,
  status      text,
  snapshot    jsonb NOT NULL,          -- full previous banquet_beos row
  changed_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beo_versions_beo
  ON public.banquet_beo_versions (beo_id, version_no);

ALTER TABLE public.banquet_beo_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_beo_versions_property_scoped ON public.banquet_beo_versions;
CREATE POLICY banquet_beo_versions_property_scoped ON public.banquet_beo_versions
  FOR SELECT TO authenticated
  USING (public.banquet_can_access_property(property_id));

CREATE OR REPLACE FUNCTION public.trg_beo_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.banquet_beo_versions
    (property_id, beo_id, event_id, version_no, status, snapshot, changed_by)
  SELECT
    OLD.property_id,
    OLD.id,
    OLD.event_id,
    COALESCE((SELECT MAX(version_no) FROM public.banquet_beo_versions WHERE beo_id = OLD.id), 0) + 1,
    OLD.status,
    to_jsonb(OLD),
    auth.uid()::text;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_beo_version ON public.banquet_beos;
CREATE TRIGGER trg_beo_version
  BEFORE UPDATE ON public.banquet_beos
  FOR EACH ROW EXECUTE FUNCTION public.trg_beo_version();

COMMENT ON TABLE public.banquet_beo_versions IS
  'One row per prior BEO state — version 1 is the original. Backs GET /api/banquet-events/beos/:id/versions.';
