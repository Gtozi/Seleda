-- Migration: Backfill schema for housekeeping_room_extras + housekeeping_priority_queue
--
-- These two tables already exist in the live database (created out-of-band
-- during early development) but were never captured in a tracked migration.
-- This backfill records their canonical schema so fresh environments built
-- from supabase/migrations are consistent with production.
--
-- Both tables are idempotent (CREATE TABLE IF NOT EXISTS) — no-op on the
-- live DB where they already exist; creates them on fresh environments.
--
-- Backs:
--   - Rooms Board module (housekeeping_room_extras, housekeeping_priority_queue)
--   - Supervisor Console (DND rooms, priority queue, room status overview)
--   - Room status / assignment / maintenance endpoints

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── housekeeping_room_extras ──────────────────────────────────────────
-- Per-room housekeeping metadata that extends the canonical rooms table.
-- HK-specific statuses (Inspected, Ready, Pickup, Sleep-Out, DND, etc.)
-- live here because rooms.status has a CHECK constraint limited to the
-- canonical set (Vacant Clean/Dirty, Occupied Clean/Dirty, etc.).
CREATE TABLE IF NOT EXISTS housekeeping_room_extras (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  property_id    UUID REFERENCES properties(id),
  room_number    TEXT NOT NULL,
  dnd            BOOLEAN NOT NULL DEFAULT FALSE,
  last_cleaned   TEXT,
  last_inspected TEXT,
  housekeeper_id TEXT REFERENCES housekeeping_staff(id),
  arrival        DATE,
  departure      DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hk_status      TEXT,
  UNIQUE (property_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_room_extras_property
  ON housekeeping_room_extras(property_id);

-- ── housekeeping_priority_queue ───────────────────────────────────────
-- Rooms flagged by supervisors for immediate attention. Surfaced in the
-- Supervisor Console and Rooms Board. Add/remove via the
-- POST /api/hk-portal/rooms-board/priority endpoint.
CREATE TABLE IF NOT EXISTS housekeeping_priority_queue (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  property_id UUID REFERENCES properties(id),
  room_number TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_priority_queue_property
  ON housekeeping_priority_queue(property_id);

-- Grant access (matches the existing tables' grants).
GRANT SELECT, INSERT, UPDATE, DELETE ON housekeeping_room_extras TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON housekeeping_priority_queue TO authenticated;
