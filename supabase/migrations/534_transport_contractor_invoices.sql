-- Contractor Invoices
-- Invoice submission / verification / payment tracking for taxi companies,
-- chauffeur services, bus and tour operators (spec §21 "Invoice Verification").

-- ============================================================================
-- transport_contractor_invoices
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_contractor_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  invoice_number  TEXT NOT NULL,
  contractor_id   UUID REFERENCES transport_contractors(id) ON DELETE SET NULL,
  period_start    DATE,
  period_end      DATE,
  trip_count      INTEGER NOT NULL DEFAULT 0 CHECK (trip_count >= 0),
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  -- Expected amount computed from contractor rate card × trips, used by the
  -- verification step to flag over-billing.
  expected_amount NUMERIC(12,2) CHECK (expected_amount IS NULL OR expected_amount >= 0),
  variance        NUMERIC(12,2),
  status          TEXT NOT NULL DEFAULT 'Submitted'
                    CHECK (status IN ('Submitted', 'Under Review', 'Verified', 'Disputed', 'Paid', 'Rejected')),
  submitted_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  verified_by     TEXT,
  verified_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_contractor_invoices_property   ON transport_contractor_invoices(property_id);
CREATE INDEX IF NOT EXISTS idx_contractor_invoices_contractor ON transport_contractor_invoices(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_invoices_status     ON transport_contractor_invoices(property_id, status);

DROP TRIGGER IF EXISTS transport_contractor_invoices_updated_at ON transport_contractor_invoices;
CREATE TRIGGER transport_contractor_invoices_updated_at
  BEFORE UPDATE ON transport_contractor_invoices
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_contractor_invoices TO authenticated;

ALTER TABLE transport_contractor_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_contractor_invoices_read ON transport_contractor_invoices;
CREATE POLICY transport_contractor_invoices_read ON transport_contractor_invoices
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_contractor_invoices_write ON transport_contractor_invoices;
CREATE POLICY transport_contractor_invoices_write ON transport_contractor_invoices
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));
