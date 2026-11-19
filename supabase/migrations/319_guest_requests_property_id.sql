-- Migration: Add property_id to guest_requests
--
-- The guest_requests table (migration 117) had no property_id column, so the
-- HK Supervisor Console query that filtered by property_id silently failed.
-- This adds the column (nullable for backward compatibility with existing FO
-- routes that don't set it) and an index for property-scoped lookups.

ALTER TABLE guest_requests ADD COLUMN IF NOT EXISTS property_id UUID;

CREATE INDEX IF NOT EXISTS idx_guest_requests_property ON guest_requests(property_id);
