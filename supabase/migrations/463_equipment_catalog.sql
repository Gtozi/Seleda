-- =============================================================================
-- Migration 463: Banquet & Events — central equipment catalog
-- =============================================================================
-- GAP: Equipment Management (§24) / Resource Management (§17). banquet_equipment
-- rows were per-event requirement lists with no central stock, so "Equipment
-- Availability" (dashboard KPI) and "Equipment Shortage" (alert) could not be
-- computed and there was nothing to check a booking against.
--
-- Adds:
--   banquet_equipment_catalog — the property's rentable stock
--     (projectors, screens, LED walls, …) with a total_quantity.
--   banquet_equipment.catalog_item_id — links an event's requirement line to
--     the catalog item it draws from.
--   event_equipment_demand (view) — per catalog item, the quantity committed to
--     overlapping live events; demand > stock = shortage.
--
-- Depends on: 112 (banquet_equipment), 444 (event_bookings),
--             458 (banquet_can_access_property)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.banquet_equipment_catalog (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id    uuid,
  item_name      text NOT NULL,
  category       text,                 -- AV | Lighting | Staging | Interpretation | …
  total_quantity integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_equipment_catalog_property
  ON public.banquet_equipment_catalog (property_id);

ALTER TABLE public.banquet_equipment_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banquet_equipment_catalog_property_scoped ON public.banquet_equipment_catalog;
CREATE POLICY banquet_equipment_catalog_property_scoped ON public.banquet_equipment_catalog
  FOR ALL TO authenticated
  USING (public.banquet_can_access_property(property_id))
  WITH CHECK (public.banquet_can_access_property(property_id));

DROP TRIGGER IF EXISTS trg_banquet_equipment_catalog_updated_at ON public.banquet_equipment_catalog;
CREATE TRIGGER trg_banquet_equipment_catalog_updated_at
  BEFORE UPDATE ON public.banquet_equipment_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.banquet_equipment
  ADD COLUMN IF NOT EXISTS catalog_item_id text REFERENCES public.banquet_equipment_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_banquet_equipment_catalog_item
  ON public.banquet_equipment (catalog_item_id);

-- Committed demand per catalog item across events that overlap in time.
-- Only live bookings (Confirmed/Planning/InProgress) consume stock.
CREATE OR REPLACE VIEW public.event_equipment_demand AS
SELECT
  c.id                                                        AS catalog_item_id,
  c.property_id,
  c.item_name,
  c.total_quantity,
  e.event_id,
  COALESCE(SUM(e.quantity), 0)                                AS quantity_committed
FROM public.banquet_equipment_catalog c
LEFT JOIN (
  SELECT eq.catalog_item_id, eq.event_id, eq.quantity
  FROM public.banquet_equipment eq
  JOIN public.event_bookings eb ON eb.id = eq.event_id
  WHERE eb.status IN ('Confirmed','Planning','InProgress')
) e ON e.catalog_item_id = c.id
WHERE c.is_active
GROUP BY c.id, c.property_id, c.item_name, c.total_quantity, e.event_id;

COMMENT ON VIEW public.event_equipment_demand IS
  'Per catalog item x event committed quantity. The EquipmentShortage alert '
  '(465) and GET /equipment-catalog both read this to compare concurrent '
  'demand against total_quantity.';
