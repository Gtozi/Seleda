-- 635_ops_calendar_events.sql
-- Operations Portal — Operational Calendar (/erp/operations/calandar).
--
-- Backs OperationalCalendar.tsx. The calendar aggregates live events from
-- the other portals — banquet_events (weddings/conferences), VIP
-- reservations, pm_schedules, hr_training_sessions, fb/rms/sales
-- promotions, sec_compliance_audits, fin_external_audits, group_blocks and
-- ops_cross_dept_tasks. THIS table holds ops-native events that don't live
-- in another portal: holidays, drills, and manually-added calendar items.
--
-- Seeded with the mock rows whose categories have no live source
-- (holiday, drill, and the ops-planned training/audit/promotion items).
-- The mock conference/wedding/vip/maintenance rows are NOT seeded —
-- real equivalents already exist in banquet_events / reservations /
-- pm_schedules.

CREATE TABLE IF NOT EXISTS public.ops_calendar_events (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  title       TEXT NOT NULL,
  event_date  DATE NOT NULL,
  end_date    DATE,
  type        TEXT NOT NULL DEFAULT 'event' CHECK (type IN (
                'conference','wedding','holiday','vip','maintenance',
                'promotion','drill','training','audit','event','group','task'
              )),
  location    TEXT,
  attendees   INTEGER,
  description TEXT,
  source_ref  TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_calendar_events_prop_date
  ON public.ops_calendar_events(property_id, event_date);

CREATE OR REPLACE FUNCTION public.update_ops_calendar_events_timestamp()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_calendar_events_updated_at ON public.ops_calendar_events;
CREATE TRIGGER trg_ops_calendar_events_updated_at
  BEFORE UPDATE ON public.ops_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_ops_calendar_events_timestamp();

ALTER TABLE public.ops_calendar_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_calendar_events TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Dates anchored to relative offsets so the calendar has content around
-- "now" regardless of when it is applied.
INSERT INTO public.ops_calendar_events
  (id, property_id, title, event_date, type, location, attendees, description, created_by)
VALUES
  ('ops-cal-seed-001', '18762279-a389-41c9-9169-7ebc682e9703',
   'Public Holiday - Independence Day', CURRENT_DATE + 3, 'holiday', NULL, NULL,
   'National holiday - expect high occupancy', 'General Manager'),
  ('ops-cal-seed-002', '18762279-a389-41c9-9169-7ebc682e9703',
   'Fire Drill - All Staff', CURRENT_DATE + 5, 'drill', 'Main Lobby', NULL,
   'Mandatory fire safety drill for all departments', 'Safety Officer'),
  ('ops-cal-seed-003', '18762279-a389-41c9-9169-7ebc682e9703',
   'Customer Service Training', CURRENT_DATE + 7, 'training', 'Conference Room B', 20,
   'Customer service excellence training for front desk staff', 'HR Manager'),
  ('ops-cal-seed-004', '18762279-a389-41c9-9169-7ebc682e9703',
   'Quality Audit - Housekeeping', CURRENT_DATE + 10, 'audit', NULL, NULL,
   'Quarterly quality audit of housekeeping standards', 'Quality Manager'),
  ('ops-cal-seed-005', '18762279-a389-41c9-9169-7ebc682e9703',
   'Summer Promotion Launch', CURRENT_DATE + 12, 'promotion', NULL, NULL,
   'Start of summer promotional campaign', 'Sales Director'),
  ('ops-cal-seed-006', '18762279-a389-41c9-9169-7ebc682e9703',
   'VVIP Visit - Ambassador', CURRENT_DATE + 14, 'vip', 'Presidential Suite', NULL,
   'Diplomatic visit requiring enhanced security', 'General Manager')
ON CONFLICT (id) DO NOTHING;
