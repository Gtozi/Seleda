-- Migration: RMS Corporate Rates
-- Real persistence for the Revenue Management → Corporate Rates module.
--
-- Stores negotiated corporate rate agreements (account, room type, rate,
-- validity window, status) and the corporate accounts that hold them.
-- The /api/rms-portal/corporate-rates endpoint reads and writes these
-- tables directly via the service role (same pattern as /api/hk-portal/*).

-- ============================================================================
-- rms_corporate_accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_corporate_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  industry        TEXT,
  -- Negotiated volume / annual room nights expected under the agreement.
  annual_volume   INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','pending','expired','terminated')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_ca_property ON rms_corporate_accounts(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_ca_status   ON rms_corporate_accounts(status);

-- ============================================================================
-- rms_corporate_rates
-- ============================================================================
-- Negotiated rate for a specific account + room type + rate plan, valid
-- within an optional date window. `rate_type` distinguishes fixed-rate
-- agreements from floating (dynamic off BAR) agreements.
CREATE TABLE IF NOT EXISTS rms_corporate_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES rms_corporate_accounts(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  rate_plan       TEXT NOT NULL DEFAULT 'Corporate',
  rate_type       TEXT NOT NULL DEFAULT 'fixed'
                    CHECK (rate_type IN ('fixed','floating')),
  -- For 'fixed' agreements: the negotiated nightly rate. For 'floating'
  -- agreements: the discount off BAR (e.g. -10 = 10% off Best Available Rate).
  rate_value      NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'ETB',
  meal_plan       TEXT DEFAULT 'RO'
                    CHECK (meal_plan IN ('RO','BB','HB','FB')),
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','pending','expired','terminated')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_cr_property ON rms_corporate_rates(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_cr_account  ON rms_corporate_rates(account_id);
CREATE INDEX IF NOT EXISTS idx_rms_cr_room     ON rms_corporate_rates(room_type);
CREATE INDEX IF NOT EXISTS idx_rms_cr_status  ON rms_corporate_rates(status);

-- ============================================================================
-- updated_at maintenance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_rms_corp_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_ca_updated ON rms_corporate_accounts;
CREATE TRIGGER trg_rms_ca_updated
  BEFORE UPDATE ON rms_corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_corp_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_cr_updated ON rms_corporate_rates;
CREATE TRIGGER trg_rms_cr_updated
  BEFORE UPDATE ON rms_corporate_rates
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_corp_set_updated_at();

-- ============================================================================
-- RLS — authenticated users can read; only revenue managers can write.
-- ============================================================================
ALTER TABLE rms_corporate_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_corporate_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_ca_read ON rms_corporate_accounts;
CREATE POLICY rms_ca_read
  ON rms_corporate_accounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_ca_write ON rms_corporate_accounts;
CREATE POLICY rms_ca_write
  ON rms_corporate_accounts FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_cr_read ON rms_corporate_rates;
CREATE POLICY rms_cr_read
  ON rms_corporate_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_cr_write ON rms_corporate_rates;
CREATE POLICY rms_cr_write
  ON rms_corporate_rates FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

-- ============================================================================
-- Seed mock data
-- ============================================================================
INSERT INTO rms_corporate_accounts
  (name, contact_name, contact_email, contact_phone, industry, annual_volume, status, notes)
VALUES
  ('Acme Corp',          'John Smith',     'john@acme.com',          '+251 911 100 001', 'Technology',   500, 'active',     'Strategic partner — annual tech conference'),
  ('Global Logistics Ltd','Sarah Lee',     'sarah@globallog.com',     '+251 911 100 002', 'Logistics',    300, 'active',     'Quarterly logistics team travel'),
  ('Ethio Airlines',     'Daniel Bekele',  'daniel@ethioair.com',     '+251 911 100 003', 'Aviation',    800, 'active',     'Crew layover agreement'),
  ('Sunrise Tours',      'Maria Garcia',   'maria@sunrisetours.com',  '+251 911 100 004', 'Tourism',      200, 'pending',    'Tour operator — pending contract renewal'),
  ('Zenith Industries',  'Robert Chen',    'robert@zenith.com',       '+251 911 100 005', 'Manufacturing', 150, 'expired',   'Agreement expired Q1 2026')
ON CONFLICT DO NOTHING;

INSERT INTO rms_corporate_rates
  (account_id, room_type, rate_plan, rate_type, rate_value, currency, meal_plan, start_date, end_date, status, notes)
SELECT id, 'Deluxe Suite',  'Corporate Fixed', 'fixed',    140, 'ETB', 'BB', DATE '2026-01-01', DATE '2026-12-31', 'active',     'Annual fixed rate' FROM rms_corporate_accounts WHERE name = 'Acme Corp'
UNION ALL SELECT id, 'Standard Room', 'Corporate Fixed', 'fixed',     95, 'ETB', 'BB', DATE '2026-01-01', DATE '2026-12-31', 'active',     'Annual fixed rate' FROM rms_corporate_accounts WHERE name = 'Acme Corp'
UNION ALL SELECT id, 'Standard Room', 'Logistics Float', 'floating', -10, 'ETB', 'RO', DATE '2026-02-01', DATE '2026-12-31', 'active',     '10% off BAR' FROM rms_corporate_accounts WHERE name = 'Global Logistics Ltd'
UNION ALL SELECT id, 'Deluxe Suite',  'Crew Rate',        'fixed',    120, 'ETB', 'BB', DATE '2026-01-01', NULL,              'active',     'Crew layover rate' FROM rms_corporate_accounts WHERE name = 'Ethio Airlines'
UNION ALL SELECT id, 'Standard Room', 'Crew Rate',        'fixed',     85, 'ETB', 'BB', DATE '2026-01-01', NULL,              'active',     'Crew layover rate' FROM rms_corporate_accounts WHERE name = 'Ethio Airlines'
UNION ALL SELECT id, 'Ocean View',    'Tour Operator',    'floating', -15, 'ETB', 'BB', DATE '2026-03-01', DATE '2026-10-31', 'pending',    '15% off BAR — pending contract' FROM rms_corporate_accounts WHERE name = 'Sunrise Tours'
UNION ALL SELECT id, 'Family Suite',   'Zenith Legacy',   'fixed',    200, 'ETB', 'HB', DATE '2025-01-01', DATE '2026-03-31', 'expired',    'Expired Q1 2026' FROM rms_corporate_accounts WHERE name = 'Zenith Industries'
ON CONFLICT DO NOTHING;
