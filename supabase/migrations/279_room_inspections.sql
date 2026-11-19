-- Migration: Room Inspections
-- Adds the room_inspections table backing the Room Inspections module
-- (docs/Housekeeping Portal new.md §9) and seeds the 4 mock inspections that
-- were previously hardcoded as `seed` in RoomInspectionsModule.tsx.
--
-- The module's Inspection contract is:
--   id, room, floor, inspector, date, result, items (12-item checklist), notes
-- where:
--   result ∈ {'Pass', 'Fail', 'Rework Required', 'Pending'}
--   items  ∈ Record<CheckItem, 'Pass' | 'Fail' | 'Pending'>
-- The 12 CheckItem keys are the docs §9 checklist:
--   Bed Quality, Bathroom, Floors, Windows, Furniture, Lighting,
--   Air Conditioning, Television, Internet, Amenities, Safety Equipment,
--   Overall Presentation
--
-- `items` is stored as JSONB so the checklist is free-form (the frontend owns
-- the canonical key set). `result` is denormalized for fast filtering and is
-- recomputed by the API whenever an item changes.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_inspections (
  id                 TEXT PRIMARY KEY,
  property_id        UUID,
  room_number        TEXT NOT NULL,
  floor              TEXT,
  inspector          TEXT,
  inspection_date    TEXT NOT NULL,
  result             TEXT NOT NULL DEFAULT 'Pending' CHECK (result IN (
                       'Pass', 'Fail', 'Rework Required', 'Pending'
                     )),
  items              JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes              TEXT,
  recommended_action TEXT,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_inspections_property
  ON room_inspections(property_id);
CREATE INDEX IF NOT EXISTS idx_room_inspections_result
  ON room_inspections(result);
CREATE INDEX IF NOT EXISTS idx_room_inspections_room
  ON room_inspections(room_number);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_room_inspections_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_room_inspections_updated_at ON room_inspections;
CREATE TRIGGER trigger_room_inspections_updated_at
  BEFORE UPDATE ON room_inspections
  FOR EACH ROW
  EXECUTE FUNCTION update_room_inspections_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON room_inspections TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 4 inspections previously hardcoded as `seed` in
-- RoomInspectionsModule.tsx. Uses the single demo property.
INSERT INTO room_inspections
  (id, property_id, room_number, floor, inspector, inspection_date, result, items, notes)
VALUES
  (
    'INS-4001',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '101',
    '1st Floor',
    'Supervisor A. Doe',
    '2026-08-20 09:30',
    'Pass',
    '{"Bed Quality":"Pass","Bathroom":"Pass","Floors":"Pass","Windows":"Pass","Furniture":"Pass","Lighting":"Pass","Air Conditioning":"Pass","Television":"Pass","Internet":"Pass","Amenities":"Pass","Safety Equipment":"Pass","Overall Presentation":"Pass"}'::jsonb,
    NULL
  ),
  (
    'INS-4002',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '102',
    '1st Floor',
    'Supervisor A. Doe',
    '2026-08-20 10:15',
    'Fail',
    '{"Bed Quality":"Pass","Bathroom":"Fail","Floors":"Pass","Windows":"Pass","Furniture":"Pass","Lighting":"Pass","Air Conditioning":"Pass","Television":"Pass","Internet":"Pass","Amenities":"Fail","Safety Equipment":"Pass","Overall Presentation":"Fail"}'::jsonb,
    'Bathroom tiles stained; amenities missing'
  ),
  (
    'INS-4003',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '204',
    '2nd Floor',
    'Supervisor B. Roe',
    '2026-08-20 11:00',
    'Rework Required',
    '{"Bed Quality":"Pass","Bathroom":"Pass","Floors":"Pass","Windows":"Pass","Furniture":"Fail","Lighting":"Pass","Air Conditioning":"Pass","Television":"Pass","Internet":"Pass","Amenities":"Pass","Safety Equipment":"Pass","Overall Presentation":"Pass"}'::jsonb,
    'Dust on furniture'
  ),
  (
    'INS-4004',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '305',
    '3rd Floor',
    'Supervisor B. Roe',
    '2026-08-20 11:45',
    'Pending',
    '{"Bed Quality":"Pass","Bathroom":"Pass","Floors":"Pass","Windows":"Pass","Furniture":"Pass","Lighting":"Pending","Air Conditioning":"Pending","Television":"Pending","Internet":"Pending","Amenities":"Pending","Safety Equipment":"Pending","Overall Presentation":"Pending"}'::jsonb,
    NULL
  )
ON CONFLICT (id) DO NOTHING;
