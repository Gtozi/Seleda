-- =============================================================================
-- Migration 470: Banquet & Events — reusable vendor registry
-- =============================================================================
-- GAP: Vendor Coordination (§25) needed a vendor master — banquet_vendors
-- rows are per-event contracts, so the same vendor had to be re-keyed for
-- every event and there was no single place to keep contact details current.
--
-- Adds:
--   banquet_vendor_registry — the property's reusable vendor master.
--   banquet_vendors.registry_id — links an event's vendor contract to the
--     master record; registry data is copied onto the event row at create
--     time (in the route) so existing reads keep working.
--
-- Depends on: 112 (banquet_vendors), 458 (RLS helper)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_vendor_registry (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id    uuid,
  vendor_name    text NOT NULL,
  vendor_type    text,
  contact_person text,
  phone          text,
  email          text,
  services       text,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_registry_property
  ON public.banquet_vendor_registry (property_id);

ALTER TABLE public.banquet_vendor_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_vendor_registry_property_scoped ON public.banquet_vendor_registry;
CREATE POLICY banquet_vendor_registry_property_scoped ON public.banquet_vendor_registry
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_vendor_registry_updated_at ON public.banquet_vendor_registry;
CREATE TRIGGER trg_vendor_registry_updated_at
  BEFORE UPDATE ON public.banquet_vendor_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.banquet_vendors
  ADD COLUMN IF NOT EXISTS registry_id text REFERENCES public.banquet_vendor_registry(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.banquet_vendors.registry_id IS
  'Optional link to banquet_vendor_registry — the reusable vendor master.';
