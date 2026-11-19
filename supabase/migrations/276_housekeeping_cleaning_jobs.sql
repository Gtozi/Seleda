-- Migration: Housekeeping Room Cleaning Jobs
-- Adds the housekeeping_cleaning_jobs table backing the Room Cleaning module
-- (docs/Housekeeping Portal new.md §7) and seeds mock data using the existing
-- rooms + housekeeping_staff rows.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housekeeping_cleaning_jobs (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  room_number   TEXT NOT NULL,
  floor         INTEGER NOT NULL,
  service_type  TEXT NOT NULL CHECK (service_type IN (
                  'Full Service', 'Stayover Service', 'Express Service',
                  'Eco Service', 'Turndown Service'
                )),
  attendant_id   TEXT,
  attendant_name TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (
                  'Pending', 'In Progress', 'Completed'
                )),
  started_at    TEXT,
  completed_at  TEXT,
  -- checklist is a JSON object mapping each StandardCleaningStep -> boolean
  checklist     JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_cleaning_jobs_property
  ON housekeeping_cleaning_jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_cleaning_jobs_status
  ON housekeeping_cleaning_jobs(status);
CREATE INDEX IF NOT EXISTS idx_hk_cleaning_jobs_room
  ON housekeeping_cleaning_jobs(room_number);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_cleaning_jobs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_cleaning_jobs_updated_at ON housekeeping_cleaning_jobs;
CREATE TRIGGER trigger_hk_cleaning_jobs_updated_at
  BEFORE UPDATE ON housekeeping_cleaning_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_cleaning_jobs_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON housekeeping_cleaning_jobs TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Uses the single demo property and its real rooms (02, 04, 06, 09, 10 — all
-- currently Vacant Dirty) and housekeeping staff (HK-01..HK-04).
-- The checklist JSON keys mirror the StandardCleaningStep union in
-- RoomCleaningModule.tsx.

INSERT INTO housekeeping_cleaning_jobs
  (id, property_id, room_number, floor, service_type, attendant_id, attendant_name, status, started_at, completed_at, checklist, notes)
VALUES
  (
    'RC-1001',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '02', 1, 'Full Service', 'HK-01', 'Elena R.', 'In Progress', '08:15 AM', NULL,
    '{"Bed Making": true, "Bathroom Cleaning": true, "Vacuuming": false, "Dusting": false, "Trash Removal": true, "Surface Sanitization": false, "Amenity Refill": false, "Towel Replacement": false}'::jsonb,
    'Checkout turnover — VIP arrival at 2 PM.'
  ),
  (
    'RC-1002',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '04', 1, 'Stayover Service', 'HK-02', 'Carlos M.', 'In Progress', '09:02 AM', NULL,
    '{"Bed Making": true, "Bathroom Cleaning": false, "Vacuuming": false, "Dusting": false, "Trash Removal": true, "Surface Sanitization": false, "Amenity Refill": true, "Towel Replacement": true}'::jsonb,
    NULL
  ),
  (
    'RC-1003',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '06', 1, 'Express Service', 'HK-04', 'David K.', 'Pending', NULL, NULL,
    '{"Bed Making": false, "Bathroom Cleaning": false, "Vacuuming": false, "Dusting": false, "Trash Removal": false, "Surface Sanitization": false, "Amenity Refill": false, "Towel Replacement": false}'::jsonb,
    'Early arrival — fast turnaround required.'
  ),
  (
    'RC-1004',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '09', 1, 'Turndown Service', 'HK-03', 'Aisha P.', 'Completed', '06:40 PM', '07:05 PM',
    '{"Bed Making": true, "Bathroom Cleaning": true, "Vacuuming": true, "Dusting": true, "Trash Removal": true, "Surface Sanitization": true, "Amenity Refill": true, "Towel Replacement": true}'::jsonb,
    NULL
  ),
  (
    'RC-1005',
    '18762279-a389-41c9-9169-7ebc682e9703',
    '10', 1, 'Eco Service', 'HK-01', 'Elena R.', 'Pending', NULL, NULL,
    '{"Bed Making": false, "Bathroom Cleaning": false, "Vacuuming": false, "Dusting": false, "Trash Removal": false, "Surface Sanitization": false, "Amenity Refill": false, "Towel Replacement": false}'::jsonb,
    'Reduced chemical/water service per guest request.'
  )
ON CONFLICT (id) DO NOTHING;
