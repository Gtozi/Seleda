-- HR Shift & Rostering
-- Adds dedicated tables for shift types, shift templates, and shift swap
-- requests. Reuses the existing hr_team_roster table (migration 416) for
-- the weekly roster grid, extending it with a published flag and a status
-- column for swap workflow tracking.
--
-- Tables created here:
--   hr_shift_types     — Morning / Evening / Night / Split / Flexible / On Call
--   hr_shift_templates — reusable rotation patterns per department
--   hr_shift_swaps     — employee shift swap requests with approval workflow

-- ============================================================================
-- hr_shift_types
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_shift_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  start_time      TEXT,        -- '07:00' or 'Flexible'
  end_time        TEXT,        -- '15:00' or 'Flexible'
  color           TEXT NOT NULL DEFAULT 'bg-slate-500',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_shift_types_property_name
  ON hr_shift_types(property_id, name);

CREATE INDEX IF NOT EXISTS idx_hr_shift_types_property ON hr_shift_types(property_id);

-- ============================================================================
-- hr_shift_templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_shift_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  departments     TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_shift_templates_property ON hr_shift_templates(property_id);

-- ============================================================================
-- hr_shift_swaps
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_shift_swaps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL,
  employee_name       TEXT NOT NULL,
  current_shift       TEXT NOT NULL,
  requested_shift     TEXT NOT NULL,
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_shift_swaps_property ON hr_shift_swaps(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_shift_swaps_status   ON hr_shift_swaps(status);

-- ============================================================================
-- Extend hr_team_roster (migration 416) with published flag
-- ============================================================================
ALTER TABLE public.hr_team_roster
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shift_type_id UUID REFERENCES hr_shift_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hr_team_roster_published ON hr_team_roster(property_id, is_published);

-- ============================================================================
-- Triggers (reuse hr_recruit_set_updated_at from migration 412)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_shift_types_updated_at ON hr_shift_types;
CREATE TRIGGER hr_shift_types_updated_at
  BEFORE UPDATE ON hr_shift_types
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_shift_templates_updated_at ON hr_shift_templates;
CREATE TRIGGER hr_shift_templates_updated_at
  BEFORE UPDATE ON hr_shift_templates
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_shift_swaps_updated_at ON hr_shift_swaps;
CREATE TRIGGER hr_shift_swaps_updated_at
  BEFORE UPDATE ON hr_shift_swaps
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_shift_types     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_shift_templates  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_shift_swaps      TO authenticated;

ALTER TABLE hr_shift_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_shift_swaps    ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user.
DROP POLICY IF EXISTS hr_shift_types_read ON hr_shift_types;
CREATE POLICY hr_shift_types_read ON hr_shift_types
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_shift_templates_read ON hr_shift_templates;
CREATE POLICY hr_shift_templates_read ON hr_shift_templates
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_shift_swaps_read ON hr_shift_swaps;
CREATE POLICY hr_shift_swaps_read ON hr_shift_swaps
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins.
DROP POLICY IF EXISTS hr_shift_types_write ON hr_shift_types;
CREATE POLICY hr_shift_types_write ON hr_shift_types
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_shift_templates_write ON hr_shift_templates;
CREATE POLICY hr_shift_templates_write ON hr_shift_templates
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_shift_swaps_write ON hr_shift_swaps;
CREATE POLICY hr_shift_swaps_write ON hr_shift_swaps
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Mock data seed — Gheralta Main Property (GH-MAIN)
-- Mirrors the placeholder data in ShiftRostering.tsx.
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_morning UUID;
  v_evening UUID;
  v_night   UUID;
  v_split   UUID;
  v_flex    UUID;
  v_oncall  UUID;
BEGIN
  -- Shift types
  IF NOT EXISTS (SELECT 1 FROM hr_shift_types WHERE property_id = v_main_property AND name = 'Morning') THEN
    INSERT INTO hr_shift_types (property_id, name, start_time, end_time, color, is_active)
    VALUES
      (v_main_property, 'Morning',     '07:00', '15:00', 'bg-blue-500',    TRUE),
      (v_main_property, 'Evening',     '15:00', '23:00', 'bg-purple-500',  TRUE),
      (v_main_property, 'Night',       '23:00', '07:00', 'bg-slate-700',   TRUE),
      (v_main_property, 'Split Shift', '07:00', '11:00', 'bg-amber-500',  TRUE),
      (v_main_property, 'Flexible',    'Flexible', 'Flexible', 'bg-emerald-500', TRUE),
      (v_main_property, 'On Call',     'On Call',  'On Call',  'bg-rose-500',   TRUE)
      ON CONFLICT (property_id, name) DO NOTHING;
  END IF;

  SELECT id INTO v_morning FROM hr_shift_types WHERE property_id = v_main_property AND name = 'Morning' LIMIT 1;
  SELECT id INTO v_evening FROM hr_shift_types WHERE property_id = v_main_property AND name = 'Evening' LIMIT 1;
  SELECT id INTO v_night   FROM hr_shift_types WHERE property_id = v_main_property AND name = 'Night'   LIMIT 1;
  SELECT id INTO v_split   FROM hr_shift_types WHERE property_id = v_main_property AND name = 'Split Shift' LIMIT 1;
  SELECT id INTO v_flex    FROM hr_shift_types WHERE property_id = v_main_property AND name = 'Flexible' LIMIT 1;
  SELECT id INTO v_oncall  FROM hr_shift_types WHERE property_id = v_main_property AND name = 'On Call' LIMIT 1;

  -- Shift templates
  IF NOT EXISTS (SELECT 1 FROM hr_shift_templates WHERE property_id = v_main_property AND name = 'Standard Week Pattern') THEN
    INSERT INTO hr_shift_templates (property_id, name, description, departments, is_active)
    VALUES
      (v_main_property, 'Standard Week Pattern',  '5 days on, 2 days off rotation', ARRAY['Front Office','Housekeeping'], TRUE),
      (v_main_property, 'Hotel Weekend Pattern',  'Weekend heavy staffing',         ARRAY['Food & Beverage','Front Office'], TRUE),
      (v_main_property, 'Night Shift Rotation',   '4 nights on, 3 nights off',      ARRAY['Engineering','Security'], FALSE);
  END IF;

  -- Weekly roster (Mon Jun 24 - Sun Jun 30, 2024) for the placeholder team
  IF NOT EXISTS (SELECT 1 FROM hr_team_roster WHERE property_id = v_main_property AND roster_date = '2024-06-24' AND employee_name = 'John Doe') THEN
    INSERT INTO hr_team_roster (property_id, employee_id, employee_name, department, roster_date, shift, role, is_published, shift_type_id)
    VALUES
      -- Monday Jun 24
      (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-24', 'Morning',  'Reception', TRUE, v_morning),
      (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-24', 'Evening',  'Reception', TRUE, v_evening),
      (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Front Office', '2024-06-24', 'Morning',  'Concierge', TRUE, v_morning),
      (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Front Office', '2024-06-24', 'Night',    'Bell Services', TRUE, v_night),
      -- Tuesday Jun 25
      (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-25', 'Morning',  'Reception', TRUE, v_morning),
      (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-25', 'Evening',  'Reception', TRUE, v_evening),
      (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Front Office', '2024-06-25', 'Morning',  'Concierge', TRUE, v_morning),
      (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Front Office', '2024-06-25', 'Night',    'Bell Services', TRUE, v_night),
      -- Wednesday Jun 26
      (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-26', 'Morning',  'Reception', TRUE, v_morning),
      (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-26', 'Evening',  'Reception', TRUE, v_evening),
      (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Front Office', '2024-06-26', 'Off',      '-',         TRUE, NULL),
      (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Front Office', '2024-06-26', 'Night',    'Bell Services', TRUE, v_night),
      -- Thursday Jun 27
      (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-27', 'Morning',  'Reception', TRUE, v_morning),
      (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-27', 'Evening',  'Reception', TRUE, v_evening),
      (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Front Office', '2024-06-27', 'Morning',  'Concierge', TRUE, v_morning),
      (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Front Office', '2024-06-27', 'Night',    'Bell Services', TRUE, v_night),
      -- Friday Jun 28 (already seeded by migration 416 — skip duplicates)
      -- Saturday Jun 29
      (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-29', 'Morning',  'Reception', TRUE, v_morning),
      (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-29', 'Evening',  'Reception', TRUE, v_evening),
      (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Front Office', '2024-06-29', 'Off',      '-',         TRUE, NULL),
      (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Front Office', '2024-06-29', 'Night',    'Bell Services', TRUE, v_night),
      -- Sunday Jun 30
      (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-30', 'Off',      '-',         TRUE, NULL),
      (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-30', 'Morning',  'Reception', TRUE, v_morning),
      (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Front Office', '2024-06-30', 'Evening',  'Concierge', TRUE, v_evening),
      (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Front Office', '2024-06-30', 'Night',    'Bell Services', TRUE, v_night);
  END IF;

  -- Mark the existing migration-416 Friday Jun 28 rows as published and link shift types
  UPDATE hr_team_roster
    SET is_published = TRUE,
        shift_type_id = CASE
                          WHEN shift = 'Morning' THEN v_morning
                          WHEN shift = 'Evening' THEN v_evening
                          WHEN shift = 'Night'   THEN v_night
                          ELSE NULL
                        END
    WHERE property_id = v_main_property AND roster_date = '2024-06-28';

  -- Shift swap requests
  IF NOT EXISTS (SELECT 1 FROM hr_shift_swaps WHERE property_id = v_main_property AND employee_name = 'John Doe') THEN
    INSERT INTO hr_shift_swaps (property_id, employee_id, employee_name, current_shift, requested_shift, reason, status)
    VALUES
      (v_main_property, 'EMP-FO-01', 'John Doe',    'Morning (Jun 24)', 'Evening (Jun 24)', 'Personal commitment',  'Pending'),
      (v_main_property, 'EMP-FO-02', 'Elena Smith', 'Evening (Jun 25)', 'Morning (Jun 25)', 'Medical appointment', 'Approved');
  END IF;
END $$;
