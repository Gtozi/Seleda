-- Corporate Invoices
-- Periodic (monthly/weekly) invoices generated from Corporate Account billing
-- charges per contract (spec §11 "Monthly Billing", §22 "Corporate Billing").

-- ============================================================================
-- transport_corporate_invoices
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_corporate_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  invoice_number  TEXT NOT NULL,
  contract_id     UUID REFERENCES transport_corporate_contracts(id) ON DELETE SET NULL,
  company         TEXT,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  charge_count    INTEGER NOT NULL DEFAULT 0 CHECK (charge_count >= 0),
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status          TEXT NOT NULL DEFAULT 'Draft'
                    CHECK (status IN ('Draft', 'Issued', 'Paid', 'Overdue', 'Cancelled')),
  issued_at       TIMESTAMPTZ,
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_corporate_invoices_property ON transport_corporate_invoices(property_id);
CREATE INDEX IF NOT EXISTS idx_corporate_invoices_contract ON transport_corporate_invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_corporate_invoices_status   ON transport_corporate_invoices(property_id, status);

DROP TRIGGER IF EXISTS transport_corporate_invoices_updated_at ON transport_corporate_invoices;
CREATE TRIGGER transport_corporate_invoices_updated_at
  BEFORE UPDATE ON transport_corporate_invoices
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- Link billing charges to the invoice they were billed on.
ALTER TABLE transport_billing_charges ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES transport_corporate_invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_billing_charges_invoice ON transport_billing_charges(invoice_id);

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_corporate_invoices TO authenticated;

ALTER TABLE transport_corporate_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_corporate_invoices_read ON transport_corporate_invoices;
CREATE POLICY transport_corporate_invoices_read ON transport_corporate_invoices
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_corporate_invoices_write ON transport_corporate_invoices;
CREATE POLICY transport_corporate_invoices_write ON transport_corporate_invoices
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));
