-- Migration: Engineering Utilities & Plant Operations
-- Backs the /erp/maintenance/utilities tab (UtilitiesManagement.tsx).
-- Previously the module rendered hardcoded consumption charts, generator
-- stats, and event logs. This migration persists that data so the module
-- can fetch/persist via /api/eng-portal/utility-readings, /generators,
-- /generator-events, and /utility-alerts.
--
-- Four tables:
--   1. eng_utility_readings — periodic meter readings (electricity/water/fuel)
--   2. eng_generators       — backup power generator assets + live stats
--   3. eng_generator_events — event log per generator (start/test/refuel/…)
--   4. eng_utility_alerts   — abnormal usage / leak / voltage drift alerts

-- ── 1. Utility Readings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_utility_readings (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  reading_date  DATE NOT NULL,
  utility_type  TEXT NOT NULL CHECK (utility_type IN ('electricity', 'water', 'fuel')),
  value         NUMERIC(12,2) NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'kWh',
  reading_by    TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_util_readings_property
  ON public.eng_utility_readings(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_util_readings_type_date
  ON public.eng_utility_readings(utility_type, reading_date);

CREATE OR REPLACE FUNCTION public.update_eng_utility_readings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_util_readings_updated_at ON public.eng_utility_readings;
CREATE TRIGGER trigger_eng_util_readings_updated_at
  BEFORE UPDATE ON public.eng_utility_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_utility_readings_timestamp();

ALTER TABLE public.eng_utility_readings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_utility_readings TO authenticated;

-- ── 2. Generators ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_generators (
  id                 TEXT PRIMARY KEY,
  property_id        UUID,
  name               TEXT NOT NULL,
  code               TEXT,
  status             TEXT NOT NULL DEFAULT 'Standby' CHECK (status IN (
                       'Running', 'Standby', 'Maintenance', 'Offline'
                     )),
  running_hours      NUMERIC(10,1) NOT NULL DEFAULT 0,
  fuel_level_pct     INTEGER NOT NULL DEFAULT 100 CHECK (fuel_level_pct BETWEEN 0 AND 100),
  battery_health_pct INTEGER NOT NULL DEFAULT 100 CHECK (battery_health_pct BETWEEN 0 AND 100),
  last_service_date  DATE,
  next_service_date  DATE,
  output_kva         NUMERIC(8,1),
  engine_type        TEXT,
  control_unit       TEXT,
  location           TEXT,
  notes              TEXT,
  created_by         TEXT,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_generators_property
  ON public.eng_generators(property_id);

CREATE OR REPLACE FUNCTION public.update_eng_generators_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_generators_updated_at ON public.eng_generators;
CREATE TRIGGER trigger_eng_generators_updated_at
  BEFORE UPDATE ON public.eng_generators
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_generators_timestamp();

ALTER TABLE public.eng_generators ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_generators TO authenticated;

-- ── 3. Generator Events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_generator_events (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  generator_id  TEXT,
  event_type    TEXT NOT NULL CHECK (event_type IN (
                   'Cold Start', 'Load Test', 'Refuel', 'Service',
                   'Manual Start', 'Emergency Stop', 'Alert', 'Other'
                 )),
  event_time    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  description   TEXT,
  created_by    TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_gen_events_property
  ON public.eng_generator_events(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_gen_events_gen
  ON public.eng_generator_events(generator_id, event_time DESC);

ALTER TABLE public.eng_generator_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_generator_events TO authenticated;

-- ── 4. Utility Alerts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_utility_alerts (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  alert_type    TEXT NOT NULL CHECK (alert_type IN (
                   'Flow', 'Voltage', 'Draw', 'Leak', 'Temperature', 'Other'
                 )),
  severity      TEXT NOT NULL DEFAULT 'Warning' CHECK (severity IN (
                   'Info', 'Warning', 'Critical'
                 )),
  sector        TEXT,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                   'Active', 'Resolved'
                 )),
  detected_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMP WITH TIME ZONE,
  created_by    TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_util_alerts_property
  ON public.eng_utility_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_util_alerts_status
  ON public.eng_utility_alerts(status);

CREATE OR REPLACE FUNCTION public.update_eng_utility_alerts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_util_alerts_updated_at ON public.eng_utility_alerts;
CREATE TRIGGER trigger_eng_util_alerts_updated_at
  BEFORE UPDATE ON public.eng_utility_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_utility_alerts_timestamp();

ALTER TABLE public.eng_utility_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_utility_alerts TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

-- Utility readings: 7 days of electricity + water + fuel (matches the
-- hardcoded consumptionData array in the original component).
INSERT INTO public.eng_utility_readings (id, property_id, reading_date, utility_type, value, unit) VALUES
  ('UR-MON-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 6, 'electricity', 420, 'kWh'),
  ('UR-TUE-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 5, 'electricity', 450, 'kWh'),
  ('UR-WED-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 4, 'electricity', 480, 'kWh'),
  ('UR-THU-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 3, 'electricity', 510, 'kWh'),
  ('UR-FRI-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 2, 'electricity', 490, 'kWh'),
  ('UR-SAT-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 1, 'electricity', 460, 'kWh'),
  ('UR-SUN-E', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 0, 'electricity', 440, 'kWh'),
  ('UR-MON-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 6, 'water', 1200, 'm³'),
  ('UR-TUE-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 5, 'water', 1100, 'm³'),
  ('UR-WED-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 4, 'water', 1300, 'm³'),
  ('UR-THU-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 3, 'water', 1450, 'm³'),
  ('UR-FRI-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 2, 'water', 1250, 'm³'),
  ('UR-SAT-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 1, 'water', 1150, 'm³'),
  ('UR-SUN-W', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 0, 'water', 1050, 'm³'),
  ('UR-MON-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 6, 'fuel', 45, 'L'),
  ('UR-TUE-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 5, 'fuel', 42, 'L'),
  ('UR-WED-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 4, 'fuel', 50, 'L'),
  ('UR-THU-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 3, 'fuel', 55, 'L'),
  ('UR-FRI-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 2, 'fuel', 48, 'L'),
  ('UR-SAT-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 1, 'fuel', 40, 'L'),
  ('UR-SUN-F', '18762279-a389-41c9-9169-7ebc682e9703', CURRENT_DATE - 0, 'fuel', 38, 'L')
ON CONFLICT (id) DO NOTHING;

-- Generator: Main Generator G-01 (matches the hardcoded component).
INSERT INTO public.eng_generators
  (id, property_id, name, code, status, running_hours, fuel_level_pct, battery_health_pct,
   last_service_date, next_service_date, output_kva, engine_type, control_unit, location)
VALUES
  ('GEN-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Main Generator', 'G-01', 'Standby',
   42.5, 82, 98, CURRENT_DATE - 8, CURRENT_DATE + 22,
   500, 'V12 Turbo', 'Deep Sea 8610', 'Plant Room 1')
ON CONFLICT (id) DO NOTHING;

-- Generator events (matches the hardcoded recent events list).
INSERT INTO public.eng_generator_events
  (id, property_id, generator_id, event_type, event_time, description)
VALUES
  ('GE-001', '18762279-a389-41c9-9169-7ebc682e9703', 'GEN-001', 'Cold Start', NOW() - INTERVAL '6 hours', 'Cold Start Success'),
  ('GE-002', '18762279-a389-41c9-9169-7ebc682e9703', 'GEN-001', 'Load Test', NOW() - INTERVAL '1 day', 'Weekly Load Test Passed'),
  ('GE-003', '18762279-a389-41c9-9169-7ebc682e9703', 'GEN-001', 'Refuel', NOW() - INTERVAL '2 days', 'Refueled (200L)')
ON CONFLICT (id) DO NOTHING;

-- Utility alerts (matches the hardcoded abnormal usage detection panel).
INSERT INTO public.eng_utility_alerts
  (id, property_id, alert_type, severity, sector, description, status)
VALUES
  ('UA-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Voltage', 'Info', 'Main Grid',
   'Voltage stable. Harmonic distortion within range (0.2%).', 'Resolved'),
  ('UA-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Flow', 'Warning', 'Sector C',
   'Sudden 15% spike in water flow detected in the gardens area.', 'Active')
ON CONFLICT (id) DO NOTHING;
