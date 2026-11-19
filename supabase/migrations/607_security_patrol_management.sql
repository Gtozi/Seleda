-- Migration: Security Patrol Management
-- Backs the /erp/security/patrols tab (PatrolManagement.tsx).
--
-- Extends the shared `sec_patrols` table (single source of truth with the
-- SOC patrol board, migration 600) with scheduling fields, and adds
-- `sec_patrol_checkpoints` — a per-patrol QR/NFC checkpoint list that makes
-- scan progress real instead of a coarse percentage.

-- ── 1. Extend sec_patrols ────────────────────────────────────────────────
ALTER TABLE public.sec_patrols
  ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS scheduled_end   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS shift           TEXT CHECK (shift IN ('Day', 'Evening', 'Night')),
  ADD COLUMN IF NOT EXISTS checkpoint_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkpoint_done  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_sec_patrols_officer ON public.sec_patrols(officer);

CREATE OR REPLACE FUNCTION public.update_sec_patrols_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_patrols_updated_at ON public.sec_patrols;
CREATE TRIGGER trigger_sec_patrols_updated_at
  BEFORE UPDATE ON public.sec_patrols
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_patrols_timestamp();

-- ── 2. Patrol checkpoints ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_patrol_checkpoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id   TEXT NOT NULL REFERENCES public.sec_patrols(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  location    TEXT NOT NULL,
  order_no    INTEGER NOT NULL DEFAULT 0,
  scanned_at  TIMESTAMP WITH TIME ZONE,
  scanned_by  TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_patrol_cp_patrol ON public.sec_patrol_checkpoints(patrol_id);

ALTER TABLE public.sec_patrol_checkpoints ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_patrol_checkpoints TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Backfills scheduling fields on the existing SOC patrol rows, seeds a
-- checkpoint list per patrol, and adds one upcoming scheduled patrol.

UPDATE public.sec_patrols SET
  scheduled_start = CURRENT_DATE + TIME '09:30',
  scheduled_end   = CURRENT_DATE + TIME '12:00',
  shift = 'Day',
  checkpoint_total = 4,
  checkpoint_done = 3
WHERE id = 'PAT-001' AND scheduled_start IS NULL;

UPDATE public.sec_patrols SET
  scheduled_start = CURRENT_DATE + TIME '10:00',
  scheduled_end   = CURRENT_DATE + TIME '12:30',
  shift = 'Day',
  checkpoint_total = 4,
  checkpoint_done = 2
WHERE id = 'PAT-002' AND scheduled_start IS NULL;

UPDATE public.sec_patrols SET
  scheduled_start = CURRENT_DATE + TIME '08:30',
  scheduled_end   = CURRENT_DATE + TIME '10:30',
  shift = 'Day',
  checkpoint_total = 3,
  checkpoint_done = 3
WHERE id = 'PAT-003' AND scheduled_start IS NULL;

UPDATE public.sec_patrols SET
  scheduled_start = CURRENT_DATE + TIME '10:15',
  scheduled_end   = CURRENT_DATE + TIME '12:15',
  shift = 'Day',
  checkpoint_total = 4,
  checkpoint_done = 2
WHERE id = 'PAT-004' AND scheduled_start IS NULL;

-- One upcoming scheduled patrol (not yet started)
INSERT INTO public.sec_patrols
  (id, property_id, officer, route, status, progress, last_checkpoint,
   scheduled_start, scheduled_end, shift, checkpoint_total, checkpoint_done, notes)
VALUES
  ('PAT-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Marcus T.', 'Back of House', 'Scheduled', 0, NULL,
   CURRENT_DATE + TIME '14:00', CURRENT_DATE + TIME '16:00', 'Evening', 4, 0, 'Evening rounds — check service corridors')
ON CONFLICT (id) DO NOTHING;

-- Checkpoints for each patrol (guarded for idempotent re-runs)
INSERT INTO public.sec_patrol_checkpoints (patrol_id, name, location, order_no, scanned_at, scanned_by)
SELECT * FROM (
  VALUES
    ('PAT-001', 'Floor 1 Lobby',   'Main Building', 1, CURRENT_DATE + TIME '10:05', 'John D.'),
    ('PAT-001', 'Floor 2',         'Main Building', 2, CURRENT_DATE + TIME '10:20', 'John D.'),
    ('PAT-001', 'Floor 3',         'Main Building', 3, CURRENT_DATE + TIME '10:40', 'John D.'),
    ('PAT-001', 'Floor 4',         'Main Building', 4, NULL::timestamptz, NULL::text),
    ('PAT-002', 'Lobby',           'Public Areas',  1, CURRENT_DATE + TIME '10:20', 'Elena R.'),
    ('PAT-002', 'Restaurant',      'Public Areas',  2, CURRENT_DATE + TIME '10:45', 'Elena R.'),
    ('PAT-002', 'Pool Deck',       'Public Areas',  3, NULL::timestamptz, NULL::text),
    ('PAT-002', 'Fitness Center',  'Public Areas',  4, NULL::timestamptz, NULL::text),
    ('PAT-003', 'North Gate',      'Perimeter',     1, CURRENT_DATE + TIME '09:05', 'Carlos M.'),
    ('PAT-003', 'Fence Line East', 'Perimeter',     2, CURRENT_DATE + TIME '09:40', 'Carlos M.'),
    ('PAT-003', 'Gate',            'Perimeter',     3, CURRENT_DATE + TIME '10:15', 'Carlos M.'),
    ('PAT-004', 'Section A',       'Parking',       1, CURRENT_DATE + TIME '10:35', 'Sarah L.'),
    ('PAT-004', 'Section B',       'Parking',       2, CURRENT_DATE + TIME '10:55', 'Sarah L.'),
    ('PAT-004', 'Section C',       'Parking',       3, NULL::timestamptz, NULL::text),
    ('PAT-004', 'Stairwell P2',    'Parking',       4, NULL::timestamptz, NULL::text),
    ('PAT-005', 'Kitchen Corridor','Back of House', 1, NULL::timestamptz, NULL::text),
    ('PAT-005', 'Laundry',         'Back of House', 2, NULL::timestamptz, NULL::text),
    ('PAT-005', 'Loading Dock',    'Back of House', 3, NULL::timestamptz, NULL::text),
    ('PAT-005', 'Staff Lockers',   'Back of House', 4, NULL::timestamptz, NULL::text)
) AS v(patrol_id, name, location, order_no, scanned_at, scanned_by)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sec_patrol_checkpoints c
  WHERE c.patrol_id = v.patrol_id AND c.name = v.name
);
