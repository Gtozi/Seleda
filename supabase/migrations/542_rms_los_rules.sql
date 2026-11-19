-- Migration: RMS LOS (Length of Stay) Rules
-- Real persistence for the Revenue Management → LOS Rules module.
--
-- Stores min/max length-of-stay constraints, arrival-day restrictions,
-- and LOS-based pricing adjustments (discounts or surcharges applied to
-- specific stay lengths). The /api/rms-portal/los-rules endpoint reads
-- and writes these tables directly via the service role (same pattern as
-- /api/hk-portal/*).

-- ============================================================================
-- rms_los_rules
-- ============================================================================
-- Min/max stay constraints and arrival-day restrictions, scoped by room
-- type and an optional date window. Rules are evaluated in priority order
-- (lower priority number = higher precedence).
CREATE TABLE IF NOT EXISTS rms_los_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  room_type       TEXT NOT NULL DEFAULT 'all',
  start_date      DATE,
  end_date        DATE,
  min_los         SMALLINT NOT NULL DEFAULT 1 CHECK (min_los BETWEEN 0 AND 30),
  max_los         SMALLINT     DEFAULT NULL CHECK (max_los IS NULL OR (max_los BETWEEN 1 AND 30)),
  -- Comma-separated weekday list (0=Sun … 6=Sat). NULL = no CTA restriction.
  cta_closed_days TEXT,
  -- Comma-separated weekday list. NULL = no CTD restriction.
  ctd_closed_days TEXT,
  priority        SMALLINT NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_los_property ON rms_los_rules(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_los_room     ON rms_los_rules(room_type);
CREATE INDEX IF NOT EXISTS idx_rms_los_active   ON rms_los_rules(active);

-- ============================================================================
-- rms_los_pricing_adjustments
-- ============================================================================
-- LOS-based pricing adjustments: a percentage or absolute change to the
-- base rate for a specific stay length. Used to incentivize longer stays
-- (discounts) or discourage short stays (surcharges).
CREATE TABLE IF NOT EXISTS rms_los_pricing_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  room_type       TEXT NOT NULL DEFAULT 'all',
  los_nights      SMALLINT NOT NULL CHECK (los_nights BETWEEN 1 AND 30),
  adjustment_type TEXT NOT NULL DEFAULT 'percentage'
                    CHECK (adjustment_type IN ('percentage','absolute')),
  adjustment_value NUMERIC(10,2) NOT NULL,
  -- Negative = discount, positive = surcharge. For 'percentage' the value
  -- is a percentage delta (e.g. -10 = 10% off; 15 = 15% surcharge).
  start_date      DATE,
  end_date        DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_los_pa_property ON rms_los_pricing_adjustments(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_los_pa_room     ON rms_los_pricing_adjustments(room_type);
CREATE INDEX IF NOT EXISTS idx_rms_los_pa_active   ON rms_los_pricing_adjustments(active);

-- ============================================================================
-- updated_at maintenance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_rms_los_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_los_updated ON rms_los_rules;
CREATE TRIGGER trg_rms_los_updated
  BEFORE UPDATE ON rms_los_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_los_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_los_pa_updated ON rms_los_pricing_adjustments;
CREATE TRIGGER trg_rms_los_pa_updated
  BEFORE UPDATE ON rms_los_pricing_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_los_set_updated_at();

-- ============================================================================
-- RLS — authenticated users can read; only revenue managers can write.
-- ============================================================================
ALTER TABLE rms_los_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_los_pricing_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_los_read ON rms_los_rules;
CREATE POLICY rms_los_read
  ON rms_los_rules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_los_write ON rms_los_rules;
CREATE POLICY rms_los_write
  ON rms_los_rules FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_los_pa_read ON rms_los_pricing_adjustments;
CREATE POLICY rms_los_pa_read
  ON rms_los_pricing_adjustments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_los_pa_write ON rms_los_pricing_adjustments;
CREATE POLICY rms_los_pa_write
  ON rms_los_pricing_adjustments FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

-- ============================================================================
-- Seed mock data
-- ============================================================================
INSERT INTO rms_los_rules
  (name, room_type, start_date, end_date, min_los, max_los, cta_closed_days, ctd_closed_days, priority, active, notes)
VALUES
  ('Weekend Min 2 Nights',  'all',           DATE '2026-07-01', DATE '2026-12-31', 2, NULL, '0,1,2,3,4', NULL, 10, true,  'Friday/Saturday arrivals require a 2-night minimum stay'),
  ('Peak Season Min 3',     'Deluxe Suite',  DATE '2026-07-15', DATE '2026-08-31', 3, 14,  NULL,        NULL, 20, true,  'Peak season: 3-night min, 14-night max for Deluxe Suite'),
  ('No Same-Day Check-in',  'all',           NULL,              NULL,              1, NULL, NULL,        '0',  30, true,  'No check-out on Sundays'),
  ('Standard Room Max 7',   'Standard Room', NULL,              NULL,              1, 7,   NULL,        NULL, 50, true,  'Cap Standard Room stays at 7 nights'),
  ('Event Block Min 4',     'Family Suite',  DATE '2026-09-10', DATE '2026-09-15', 4, NULL, NULL,        NULL, 15, true,  'Conference week: 4-night min for Family Suite')
ON CONFLICT DO NOTHING;

INSERT INTO rms_los_pricing_adjustments
  (name, room_type, los_nights, adjustment_type, adjustment_value, start_date, end_date, active)
VALUES
  ('Stay 3+ Save 10%',       'all',           3,  'percentage', -10, NULL, NULL, true),
  ('Stay 7+ Save 15%',      'all',           7,  'percentage', -15, NULL, NULL, true),
  ('1-Night Surcharge 5%',  'Standard Room', 1,  'percentage',   5, NULL, NULL, true),
  ('Extended Stay 14+ 20%', 'Deluxe Suite',  14, 'percentage', -20, NULL, NULL, true),
  ('Weekend 2-Night Premium','Ocean View',   2,  'percentage',   8, DATE '2026-07-01', DATE '2026-12-31', true)
ON CONFLICT DO NOTHING;
