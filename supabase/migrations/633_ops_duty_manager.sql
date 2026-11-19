-- 633_ops_duty_manager.sql
-- Operations Portal — Duty Manager Workspace (/erp/operations/duty-manager).
--
-- Backs the three ops-native records in the workspace: the shift logbook,
-- the walkthrough checklist, and shift handovers. Guest Issues and
-- Incidents are NOT stored here — they aggregate the real `guest_requests`
-- and `sec_incidents` tables so the duty manager sees the same records as
-- the Front Office and Security portals.
--
-- Seeded with the rows that were previously hardcoded in
-- DutyManagerWorkspace.tsx (mockShiftLogs / mockWalkthroughItems /
-- mockHandovers). Uses the demo property 18762279-a389-41c9-9169-7ebc682e9703.

-- ── Shift logbook ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_shift_log_entries (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  shift_date  DATE NOT NULL,
  shift       TEXT NOT NULL CHECK (shift IN ('Morning','Afternoon','Evening','Night')),
  category    TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL,
  author      TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_shift_log_entries_prop_date
  ON public.ops_shift_log_entries(property_id, shift_date, shift);

CREATE OR REPLACE FUNCTION public.update_ops_shift_log_entries_timestamp()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_shift_log_entries_updated_at ON public.ops_shift_log_entries;
CREATE TRIGGER trg_ops_shift_log_entries_updated_at
  BEFORE UPDATE ON public.ops_shift_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_ops_shift_log_entries_timestamp();

ALTER TABLE public.ops_shift_log_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_shift_log_entries TO authenticated;

-- ── Walkthrough checklist ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_walkthrough_items (
  id           TEXT PRIMARY KEY,
  property_id  UUID,
  shift_date   DATE NOT NULL,
  shift        TEXT NOT NULL CHECK (shift IN ('Morning','Afternoon','Evening','Night')),
  area         TEXT NOT NULL,
  item         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','issue')),
  notes        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_walkthrough_items_prop_date
  ON public.ops_walkthrough_items(property_id, shift_date, shift);

CREATE OR REPLACE FUNCTION public.update_ops_walkthrough_items_timestamp()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_walkthrough_items_updated_at ON public.ops_walkthrough_items;
CREATE TRIGGER trg_ops_walkthrough_items_updated_at
  BEFORE UPDATE ON public.ops_walkthrough_items
  FOR EACH ROW EXECUTE FUNCTION public.update_ops_walkthrough_items_timestamp();

ALTER TABLE public.ops_walkthrough_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_walkthrough_items TO authenticated;

-- ── Shift handovers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_shift_handovers (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  shift_date      DATE NOT NULL,
  from_shift      TEXT NOT NULL,
  to_shift        TEXT NOT NULL,
  from_manager    TEXT NOT NULL,
  to_manager      TEXT NOT NULL,
  summary         TEXT,
  open_items      JSONB NOT NULL DEFAULT '[]',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_shift_handovers_prop_date
  ON public.ops_shift_handovers(property_id, shift_date);

CREATE OR REPLACE FUNCTION public.update_ops_shift_handovers_timestamp()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_shift_handovers_updated_at ON public.ops_shift_handovers;
CREATE TRIGGER trg_ops_shift_handovers_updated_at
  BEFORE UPDATE ON public.ops_shift_handovers
  FOR EACH ROW EXECUTE FUNCTION public.update_ops_shift_handovers_timestamp();

ALTER TABLE public.ops_shift_handovers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_shift_handovers TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Former mockShiftLogs (4), mockWalkthroughItems (9), mockHandovers (1).
INSERT INTO public.ops_shift_log_entries
  (id, property_id, shift_date, shift, category, description, author, priority, created_at)
VALUES
  ('ops-log-seed-001', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning',
   'Shift Start', 'Morning shift commenced. All departments reporting normal operations.', 'John Smith', 'low',
   CURRENT_DATE + interval '8 hours'),
  ('ops-log-seed-002', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning',
   'VIP Arrival', 'VVIP Mr. Chen arrived in Presidential Suite. Butler service activated.', 'John Smith', 'high',
   CURRENT_DATE + interval '9 hours 15 minutes'),
  ('ops-log-seed-003', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning',
   'Maintenance', 'HVAC issue reported on Floor 3. Engineering team dispatched.', 'John Smith', 'medium',
   CURRENT_DATE + interval '10 hours 30 minutes'),
  ('ops-log-seed-004', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning',
   'Guest Issue', 'Guest in Room 205 reported noise from construction. Complimentary breakfast offered.', 'John Smith', 'medium',
   CURRENT_DATE + interval '11 hours 45 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ops_walkthrough_items
  (id, property_id, shift_date, shift, area, item, status, notes, sort_order, completed_at)
VALUES
  ('ops-walk-seed-001', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Lobby', 'Front desk cleanliness', 'completed', NULL, 1, CURRENT_DATE + interval '8 hours 30 minutes'),
  ('ops-walk-seed-002', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Lobby', 'Entrance doors condition', 'completed', NULL, 2, CURRENT_DATE + interval '8 hours 32 minutes'),
  ('ops-walk-seed-003', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Lobby', 'Seating area arrangement', 'completed', NULL, 3, CURRENT_DATE + interval '8 hours 35 minutes'),
  ('ops-walk-seed-004', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Restaurant', 'Buffet setup readiness', 'pending', NULL, 4, NULL),
  ('ops-walk-seed-005', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Restaurant', 'Kitchen cleanliness', 'pending', NULL, 5, NULL),
  ('ops-walk-seed-006', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Pool Area', 'Water quality check', 'completed', NULL, 6, CURRENT_DATE + interval '9 hours'),
  ('ops-walk-seed-007', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Pool Area', 'Safety equipment inspection', 'issue', 'First aid kit needs restocking', 7, NULL),
  ('ops-walk-seed-008', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Parking', 'Lighting check', 'pending', NULL, 8, NULL),
  ('ops-walk-seed-009', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE, 'Morning', 'Parking', 'Security patrol log', 'completed', NULL, 9, CURRENT_DATE + interval '9 hours 20 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ops_shift_handovers
  (id, property_id, shift_date, from_shift, to_shift, from_manager, to_manager, summary, open_items, acknowledged_at, acknowledged_by, created_by, created_at)
VALUES
  ('ops-ho-seed-001', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 1, 'Night', 'Morning',
   'Night Manager - Robert Taylor', 'Morning Manager - John Smith',
   'Quiet night. One medical emergency resolved. All systems operational.',
   '["Room 305 water leak follow-up", "Elevator B inspection"]'::jsonb,
   CURRENT_DATE + interval '8 hours 5 minutes', 'John Smith', 'Robert Taylor',
   CURRENT_DATE + interval '7 hours 55 minutes')
ON CONFLICT (id) DO NOTHING;
