-- Migration: Housekeeping Linen Catalog (admin-editable par levels)
-- Adds a master linen catalog backing the Linen Management module
-- (docs/Housekeeping Portal new.md §12). Previously the par level for each
-- linen type was hardcoded in the seed migration (295_hk_linen_management.sql)
-- with no UI/API to edit it. This migration introduces hk_linen_catalog as the
-- source of truth for par levels, admin-editable via
--   POST   /api/hk-portal/linen/catalog          (create)
--   PUT    /api/hk-portal/linen/catalog/:id      (update par/active)
--   DELETE /api/hk-portal/linen/catalog/:id      (deactivate/remove)
-- gated by requirePermission('hk:linen:manage') (admin/full-access roles only).
--
-- hk_linen_stock.par is kept in sync with the catalog par_level whenever the
-- catalog is updated, so existing read paths that reference stock.par continue
-- to work.

CREATE TABLE IF NOT EXISTS hk_linen_catalog (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID,
  type         TEXT NOT NULL CHECK (type IN (
                 'Bed Sheets', 'Pillowcases', 'Duvet Covers', 'Blankets',
                 'Bath Towels', 'Hand Towels', 'Face Towels', 'Bath Mats',
                 'Robes', 'Pool Towels'
               )),
  par_level    INTEGER NOT NULL DEFAULT 0 CHECK (par_level >= 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, type)
);

CREATE INDEX IF NOT EXISTS idx_hk_linen_catalog_property
  ON hk_linen_catalog(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_linen_catalog_active
  ON hk_linen_catalog(active);

CREATE OR REPLACE FUNCTION update_hk_linen_catalog_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_linen_catalog_updated_at ON hk_linen_catalog;
CREATE TRIGGER trigger_hk_linen_catalog_updated_at
  BEFORE UPDATE ON hk_linen_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_linen_catalog_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_linen_catalog TO authenticated;

-- ── Seed catalog from existing hk_linen_stock par values ──────────────────
-- One catalog row per (property_id, type) with par_level copied from stock.
-- Also covers the demo property's 10 seeded linen types.
INSERT INTO hk_linen_catalog (property_id, type, par_level, active)
SELECT property_id, type, par, TRUE
FROM hk_linen_stock
ON CONFLICT (property_id, type) DO NOTHING;
