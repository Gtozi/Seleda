-- Migration: Housekeeping Linen Management
-- Adds the tables backing the Linen Management module
-- (docs/Housekeeping Portal new.md §12) and seeds the mock stock + log
-- entries that were previously hardcoded in LinenManagementModule.tsx.
--
-- Two tables:
--   hk_linen_stock — one row per linen type with par/in_stock/in_use/
--                    at_laundry/damaged/lost counters.
--   hk_linen_log   — append-only operations log (Issue / Return / Damaged /
--                    Lost / Linen Count).
--
-- The POST /api/hk-portal/linen/operation route applies an operation by
-- updating the stock counters atomically and inserting a log row.

-- ── hk_linen_stock ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hk_linen_stock (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID,
  type         TEXT NOT NULL CHECK (type IN (
                 'Bed Sheets', 'Pillowcases', 'Duvet Covers', 'Blankets',
                 'Bath Towels', 'Hand Towels', 'Face Towels', 'Bath Mats',
                 'Robes', 'Pool Towels'
               )),
  par          INTEGER NOT NULL DEFAULT 0 CHECK (par >= 0),
  in_stock     INTEGER NOT NULL DEFAULT 0 CHECK (in_stock >= 0),
  in_use       INTEGER NOT NULL DEFAULT 0 CHECK (in_use >= 0),
  at_laundry   INTEGER NOT NULL DEFAULT 0 CHECK (at_laundry >= 0),
  damaged      INTEGER NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  lost         INTEGER NOT NULL DEFAULT 0 CHECK (lost >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, type)
);

CREATE INDEX IF NOT EXISTS idx_hk_linen_stock_property
  ON hk_linen_stock(property_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_linen_stock_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_linen_stock_updated_at ON hk_linen_stock;
CREATE TRIGGER trigger_hk_linen_stock_updated_at
  BEFORE UPDATE ON hk_linen_stock
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_linen_stock_timestamp();

-- ── hk_linen_log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hk_linen_log (
  id           TEXT PRIMARY KEY,
  property_id  UUID,
  operation    TEXT NOT NULL CHECK (operation IN (
                 'Issue Linen', 'Return Linen', 'Damaged Linen',
                 'Lost Linen', 'Linen Count'
               )),
  type         TEXT NOT NULL CHECK (type IN (
                 'Bed Sheets', 'Pillowcases', 'Duvet Covers', 'Blankets',
                 'Bath Towels', 'Hand Towels', 'Face Towels', 'Bath Mats',
                 'Robes', 'Pool Towels'
               )),
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  location     TEXT,
  staff        TEXT,
  notes        TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_linen_log_property
  ON hk_linen_log(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_linen_log_created_at
  ON hk_linen_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hk_linen_log_operation
  ON hk_linen_log(operation);

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_linen_stock TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hk_linen_log TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Uses the single demo property (matches other HK seed migrations).
-- Stock values mirror the seedStock array in LinenManagementModule.tsx.
INSERT INTO hk_linen_stock (property_id, type, par, in_stock, in_use, at_laundry, damaged, lost)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Bed Sheets',   300, 180,  95, 22, 3, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Pillowcases',  600, 410, 160, 28, 2, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Duvet Covers', 200, 120,  70,  8, 2, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Blankets',     150, 110,  38,  0, 2, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Bath Towels',  500,  95, 280,120, 5, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Hand Towels',  400, 220, 140, 36, 4, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Face Towels',  400, 260, 120, 18, 2, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Bath Mats',    200, 130,  60,  8, 2, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Robes',        100,  70,  28,  0, 2, 0),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Pool Towels',  250, 140,  90, 18, 2, 0)
ON CONFLICT (property_id, type) DO NOTHING;

-- Log entries mirror the seedLog array in LinenManagementModule.tsx.
-- created_at is back-dated to today so they appear at the top of the log.
INSERT INTO hk_linen_log (id, property_id, operation, type, quantity, location, staff, notes, created_at)
VALUES
  ('LN-2001', '18762279-a389-41c9-9169-7ebc682e9703', 'Issue Linen',   'Bath Towels',  20, 'Floor 3',     'Maria S.',  NULL,           NOW() - INTERVAL '4 hours'),
  ('LN-2002', '18762279-a389-41c9-9169-7ebc682e9703', 'Return Linen',  'Bed Sheets',   15, 'Floor 2',     'James L.',  NULL,           NOW() - INTERVAL '3 hours 30 minutes'),
  ('LN-2003', '18762279-a389-41c9-9169-7ebc682e9703', 'Damaged Linen', 'Pillowcases',   2, 'Floor 1',     'Priya K.',  'Torn seams',   NOW() - INTERVAL '3 hours 15 minutes'),
  ('LN-2004', '18762279-a389-41c9-9169-7ebc682e9703', 'Lost Linen',    'Robes',         1, 'Room 410',    'Carlos M.', 'Guest departure', NOW() - INTERVAL '2 hours 40 minutes'),
  ('LN-2005', '18762279-a389-41c9-9169-7ebc682e9703', 'Linen Count',   'Bath Towels', 500, 'Linen Room',  'Aisha B.',  NULL,           NOW() - INTERVAL '2 hours')
ON CONFLICT (id) DO NOTHING;
