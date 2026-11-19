-- Migration: property isolation for Channel Manager
-- Adds property_id to channel_connections so each tenant only sees
-- its own channels and related sync logs / mappings.

ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_channel_connections_property_id
  ON channel_connections(property_id);

-- Child tables (channel_room_mapping, inventory_sync_log, etc.) remain scoped
-- through their channel_id FK, avoiding redundant denormalized columns.
