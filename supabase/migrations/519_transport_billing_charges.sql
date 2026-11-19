-- 519_transport_billing_charges.sql
-- Billing & charges for trips — folio/corporate/internal postings.

CREATE TABLE IF NOT EXISTS transport_billing_charges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  charge_number    TEXT NOT NULL,
  trip_id          UUID REFERENCES transport_requests(id) ON DELETE SET NULL,
  guest_name       TEXT,
  room             TEXT,
  type             TEXT,
  billing_type     TEXT NOT NULL DEFAULT 'Guest Folio'
                     CHECK (billing_type IN ('Guest Folio', 'Corporate Account', 'Event Master Account', 'Internal Cost Center')),
  amount           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status           TEXT NOT NULL DEFAULT 'Pending'
                     CHECK (status IN ('Pending', 'Posted', 'Failed', 'Refunded')),
  charge_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method   TEXT
                     CHECK (payment_method IS NULL OR payment_method IN ('Room Charge', 'Credit Card', 'Cash', 'Corporate Credit', 'Internal Transfer')),
  reference        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, charge_number)
);

CREATE INDEX IF NOT EXISTS idx_billing_charges_property ON transport_billing_charges(property_id);
CREATE INDEX IF NOT EXISTS idx_billing_charges_status   ON transport_billing_charges(property_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_charges_date     ON transport_billing_charges(property_id, charge_date DESC);
CREATE INDEX IF NOT EXISTS idx_billing_charges_trip     ON transport_billing_charges(trip_id);

DROP TRIGGER IF EXISTS transport_billing_charges_updated_at ON transport_billing_charges;
CREATE TRIGGER transport_billing_charges_updated_at
  BEFORE UPDATE ON transport_billing_charges
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_billing_charges TO authenticated;

ALTER TABLE transport_billing_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_billing_charges_read ON transport_billing_charges;
CREATE POLICY transport_billing_charges_read ON transport_billing_charges
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_billing_charges_write ON transport_billing_charges;
CREATE POLICY transport_billing_charges_write ON transport_billing_charges
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's charges for GH-MAIN ────────────────────────────────────
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  tr_001 UUID; tr_003 UUID; tr_006 UUID; tr_002 UUID; tr_005 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_billing_charges WHERE property_id = v_main) THEN
    SELECT id INTO tr_001 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-001';
    SELECT id INTO tr_003 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-003';
    SELECT id INTO tr_006 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-006';
    SELECT id INTO tr_002 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-002';
    SELECT id INTO tr_005 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-005';

    INSERT INTO transport_billing_charges
      (property_id, charge_number, trip_id, guest_name, room, type, billing_type, amount, status, charge_date, payment_method, reference)
    VALUES
      (v_main, 'BL-001', tr_001, 'John Smith', '302', 'Airport Pickup', 'Guest Folio', 85.00, 'Posted', CURRENT_DATE, 'Room Charge', 'FOLIO-302-001'),
      (v_main, 'BL-002', tr_003, 'Corporate Event', NULL, 'Conference Shuttle', 'Event Master Account', 150.00, 'Pending', CURRENT_DATE, 'Corporate Credit', 'EVT-2026-07-001'),
      (v_main, 'BL-003', tr_006, 'VIP Guest', 'Penthouse', 'VIP Transport', 'Corporate Account', 350.00, 'Posted', CURRENT_DATE, 'Corporate Credit', 'CORP-ACME-001'),
      (v_main, 'BL-004', tr_002, 'Sarah Johnson', '415', 'City Transfer', 'Guest Folio', 45.00, 'Pending', CURRENT_DATE, 'Room Charge', 'FOLIO-415-002'),
      (v_main, 'BL-005', NULL, 'Staff Transportation', NULL, 'Staff Shuttle', 'Internal Cost Center', 0.00, 'Posted', CURRENT_DATE, 'Internal Transfer', 'HR-STAFF-001'),
      (v_main, 'BL-006', tr_005, 'Emily Davis', '228', 'Sightseeing Tour', 'Guest Folio', 200.00, 'Pending', CURRENT_DATE, 'Credit Card', 'CC-****4242');
  END IF;
END $$;
