-- Migration: Allow arbitrary linen types (remove fixed CHECK constraint)
-- Previously the linen type was constrained to a fixed set of 10 values
-- (Bed Sheets, Pillowcases, … Pool Towels) via CHECK constraints on
-- hk_linen_catalog.type, hk_linen_stock.type, and hk_linen_log.type.
-- This blocked admins from adding new linen types through the UI.
--
-- This migration drops those CHECK constraints so any non-empty text is
-- accepted as a linen type. The frontend now allows free-text entry when
-- adding a catalog entry, and the backend no longer validates against a
-- whitelist.

-- Drop the type CHECK constraint on hk_linen_catalog.
ALTER TABLE hk_linen_catalog DROP CONSTRAINT IF EXISTS hk_linen_catalog_type_check;

-- Drop the type CHECK constraint on hk_linen_stock.
ALTER TABLE hk_linen_stock DROP CONSTRAINT IF EXISTS hk_linen_stock_type_check;

-- Drop the type CHECK constraint on hk_linen_log.
ALTER TABLE hk_linen_log DROP CONSTRAINT IF EXISTS hk_linen_log_type_check;

-- Add a lightweight NOT NULL + length check so empty/garbage values are
-- still rejected, but any reasonable linen type name is accepted.
ALTER TABLE hk_linen_catalog ADD CONSTRAINT hk_linen_catalog_type_notempty
  CHECK (type IS NOT NULL AND length(trim(type)) > 0 AND length(type) <= 80);
ALTER TABLE hk_linen_stock ADD CONSTRAINT hk_linen_stock_type_notempty
  CHECK (type IS NOT NULL AND length(trim(type)) > 0 AND length(type) <= 80);
ALTER TABLE hk_linen_log ADD CONSTRAINT hk_linen_log_type_notempty
  CHECK (type IS NOT NULL AND length(trim(type)) > 0 AND length(type) <= 80);
