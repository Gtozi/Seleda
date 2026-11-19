-- Migration: Add property_id to lost_found for multi-property isolation
--
-- The lost_found table previously had no property_id column, so the
-- Supervisor Console's Lost & Found oversight view queried ALL items
-- across all properties — a data-leak risk in multi-property deployments.
--
-- This migration:
--   1. Adds a nullable property_id UUID column with FK to properties.
--   2. Backfills existing rows with the demo property_id (single-property
--      deployment — all existing items belong to it).
--   3. Adds an index for property-scoped queries.
--
-- The supervisor console query is updated to filter by property_id.

-- ── 1. Add column ─────────────────────────────────────────────────────
ALTER TABLE lost_found
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id);

-- ── 2. Backfill existing rows with the demo property ──────────────────
-- All current rows belong to the single demo property. In a multi-property
-- deployment, new rows must set property_id at insert time.
UPDATE lost_found
  SET property_id = '18762279-a389-41c9-9169-7ebc682e9703'::uuid
  WHERE property_id IS NULL;

-- ── 3. Index for property-scoped lookups ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lost_found_property
  ON lost_found(property_id);
