-- Migration: Inspection Schedules
-- Adds recurring inspection scheduling with time intervals (daily/weekly/monthly/quarterly).
-- The scheduler job handler reads enabled schedules and auto-creates room_inspections rows.

CREATE TABLE IF NOT EXISTS inspection_schedules (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  name            TEXT NOT NULL,
  room_number     JSONB, -- array of room numbers, or null/[] for all rooms
  floor           TEXT,
  inspector       TEXT,
  -- Interval: daily, weekly, monthly, quarterly, days (every N days)
  interval_type   TEXT NOT NULL DEFAULT 'daily' CHECK (interval_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'days')),
  -- For 'days' interval: run every N days (1-365)
  interval_days   INTEGER,
  -- Time of day in HH:MM format (24h)
  time_of_day     TEXT NOT NULL DEFAULT '09:00',
  -- For weekly: day of week (0=Sun..6=Sat). For monthly: day of month (1-28). For quarterly: month day + month (1-12)
  day_of_week     INTEGER,
  day_of_month    INTEGER,
  -- Cron expression derived from the above, used by the scheduler
  cron_expression TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_run        TIMESTAMP WITH TIME ZONE,
  next_run        TIMESTAMP WITH TIME ZONE,
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_schedules_property
  ON inspection_schedules(property_id);
CREATE INDEX IF NOT EXISTS idx_inspection_schedules_enabled
  ON inspection_schedules(enabled);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_inspection_schedules_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inspection_schedules_updated_at ON inspection_schedules;
CREATE TRIGGER trigger_inspection_schedules_updated_at
  BEFORE UPDATE ON inspection_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_inspection_schedules_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_schedules TO authenticated;

-- Seed demo schedules for the demo property
INSERT INTO inspection_schedules
  (id, property_id, name, room_number, floor, inspector, interval_type, time_of_day, cron_expression, enabled, notes)
VALUES
  (
    'SCH-INS-001',
    '18762279-a389-41c9-9169-7ebc682e9703',
    'Daily Morning Inspection',
    NULL,
    NULL,
    NULL,
    'daily',
    '09:00',
    '0 9 * * *',
    true,
    'Auto-generated daily inspection for all rooms'
  ),
  (
    'SCH-INS-002',
    '18762279-a389-41c9-9169-7ebc682e9703',
    'Weekly Deep Inspection',
    NULL,
    NULL,
    NULL,
    'weekly',
    '14:00',
    '0 14 * * 1',
    true,
    'Weekly deep inspection every Monday at 2 PM'
  )
ON CONFLICT (id) DO NOTHING;
