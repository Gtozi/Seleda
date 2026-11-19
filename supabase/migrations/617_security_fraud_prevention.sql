-- Migration: Security Fraud Prevention
-- Backs the /erp/security/fraud-prevention tab (FraudPrevention.tsx).
--
-- Two tables:
--   1. sec_fraud_cases   — fraud case register (type, amount, lifecycle,
--                          optional FK to sec_investigations)
--   2. sec_fraud_alerts  — payment/transaction alert feed; alerts can be
--                          escalated by linking them to a case
--                          (case_id, SET NULL on case delete).

-- ── 1. Fraud cases ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_fraud_cases (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  title           TEXT NOT NULL,
  fraud_type      TEXT NOT NULL DEFAULT 'Other' CHECK (fraud_type IN (
                    'Payment Fraud', 'Internal Theft', 'Expense Fraud',
                    'Identity Fraud', 'Refund Fraud', 'Card Fraud',
                    'Vendor Fraud', 'Other'
                  )),
  amount          NUMERIC(14,2),
  severity        TEXT NOT NULL DEFAULT 'Medium' CHECK (severity IN (
                    'Critical', 'High', 'Medium', 'Low'
                  )),
  status          TEXT NOT NULL DEFAULT 'Flagged' CHECK (status IN (
                    'Flagged', 'Under Review', 'Investigating',
                    'Substantiated', 'Unfounded', 'Closed'
                  )),
  source          TEXT NOT NULL DEFAULT 'Manual Report' CHECK (source IN (
                    'System Alert', 'Manual Report', 'Audit Finding', 'External'
                  )),
  description     TEXT,
  assigned_to     TEXT,
  investigation_id TEXT REFERENCES public.sec_investigations(id) ON DELETE SET NULL,
  resolution      TEXT,
  reported_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMP WITH TIME ZONE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_fraud_cases_prop ON public.sec_fraud_cases(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_fraud_cases_status ON public.sec_fraud_cases(status);
CREATE INDEX IF NOT EXISTS idx_sec_fraud_cases_inv ON public.sec_fraud_cases(investigation_id);

CREATE OR REPLACE FUNCTION public.update_sec_fraud_cases_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_fraud_cases_updated_at ON public.sec_fraud_cases;
CREATE TRIGGER trigger_sec_fraud_cases_updated_at
  BEFORE UPDATE ON public.sec_fraud_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_fraud_cases_timestamp();

ALTER TABLE public.sec_fraud_cases ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_fraud_cases TO authenticated;

-- ── 2. Fraud / payment alerts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_fraud_alerts (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  alert_type  TEXT NOT NULL CHECK (alert_type IN (
                'Large Transaction', 'Unusual Refund', 'Velocity Anomaly',
                'Card Mismatch', 'Duplicate Charge', 'After-Hours Access',
                'Discount Abuse', 'Other'
              )),
  title       TEXT NOT NULL,
  description TEXT,
  amount      NUMERIC(14,2),
  source      TEXT,
  severity    TEXT NOT NULL DEFAULT 'Medium' CHECK (severity IN (
                'Critical', 'High', 'Medium', 'Low'
              )),
  status      TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
                'New', 'Reviewed', 'Escalated', 'Dismissed'
              )),
  case_id     TEXT REFERENCES public.sec_fraud_cases(id) ON DELETE SET NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_fraud_alerts_prop ON public.sec_fraud_alerts(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_fraud_alerts_status ON public.sec_fraud_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sec_fraud_alerts_case ON public.sec_fraud_alerts(case_id);

ALTER TABLE public.sec_fraud_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_fraud_alerts TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_fraud_cases
  (id, property_id, title, fraud_type, amount, severity, status, source,
   description, assigned_to, investigation_id, resolution, reported_at, resolved_at)
VALUES
  ('FRD-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Refund Abuse — Front Desk Terminal 3',
   'Refund Fraud', 2340, 'High', 'Investigating', 'System Alert',
   'Cluster of 11 cash refunds processed without matching sale records over 2 weeks on terminal 3.',
   'Security Manager', 'INV-001', NULL,
   NOW() - INTERVAL '4 days', NULL),
  ('FRD-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Card Dispute — Room 412',
   'Card Fraud', 890, 'Medium', 'Under Review', 'External',
   'Chargeback filed claiming card-not-present fraud on in-room charges. Folio + signature review underway.',
   'Front Office Manager', NULL, NULL,
   NOW() - INTERVAL '2 days', NULL),
  ('FRD-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Vendor Invoice Padding — Linen Supplier',
   'Vendor Fraud', 5600, 'Critical', 'Investigating', 'Audit Finding',
   'Invoice quantities consistently exceed receiving logs by 8–12%. Procurement + security reviewing deliveries.',
   'Security Manager', NULL, NULL,
   NOW() - INTERVAL '9 days', NULL),
  ('FRD-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Minibar Posting Anomaly — Night Audit',
   'Internal Theft', 415, 'Medium', 'Substantiated', 'Audit Finding',
   'Night audit found systematic minibar post-and-void pattern. Confirmed via CCTV + folio review.',
   'Security Manager', 'INV-002', 'Employee separated; recovery process initiated.',
   NOW() - INTERVAL '18 days', NOW() - INTERVAL '6 days'),
  ('FRD-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Online Booking Identity Fraud Attempt',
   'Identity Fraud', 0, 'Low', 'Unfounded', 'System Alert',
   'Booking flagged for mismatched card holder vs guest name — guest verified legitimate corporate booker.',
   'Front Office Manager', NULL, 'Guest verified — corporate account authorized.',
   NOW() - INTERVAL '12 days', NOW() - INTERVAL '10 days'),
  ('FRD-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Expense Report Irregularities',
   'Expense Fraud', 1200, 'Medium', 'Flagged', 'Manual Report',
   'Duplicate meal receipts submitted across two expense reports — flagged by finance for review.',
   'HR Manager', NULL, NULL,
   NOW() - INTERVAL '8 hours', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_fraud_alerts
  (id, property_id, alert_type, title, description, amount, source,
   severity, status, case_id, created_at)
VALUES
  ('FAL-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Unusual Refund', 'Refund without sale — Terminal 3',
   'Cash refund of $310 processed with no matching transaction in POS.', 310, 'POS Monitor',
   'High', 'Escalated', 'FRD-001', NOW() - INTERVAL '4 days'),
  ('FAL-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Velocity Anomaly', '5 card attempts in 3 min — Booking Engine',
   'Rapid card attempts from same IP with different card numbers.', NULL, 'Payment Gateway',
   'Medium', 'Reviewed', NULL, NOW() - INTERVAL '1 day'),
  ('FAL-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Large Transaction', 'Cash payment $4,800 — Suite 1201',
   'Large cash settlement above reporting threshold — CTR review.', 4800, 'PMS',
   'High', 'New', NULL, NOW() - INTERVAL '5 hours'),
  ('FAL-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Duplicate Charge', 'Duplicate folio charge — Room 305',
   'Same restaurant charge posted twice within 2 minutes.', 96, 'PMS',
   'Low', 'Dismissed', NULL, NOW() - INTERVAL '3 days'),
  ('FAL-005', '18762279-a389-41c9-9169-7ebc682e9703', 'After-Hours Access', 'Back office login at 02:14 — Finance terminal',
   'Finance system accessed outside business hours from on-property terminal.', NULL, 'IT Monitor',
   'Critical', 'New', NULL, NOW() - INTERVAL '2 hours'),
  ('FAL-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Discount Abuse', 'Employee discount applied to guest folio',
   'Staff rate code applied to non-employee reservation.', 220, 'PMS',
   'Medium', 'Reviewed', NULL, NOW() - INTERVAL '2 days'),
  ('FAL-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Card Mismatch', 'Card holder ≠ guest name — Room 718',
   'Check-in card holder name does not match reservation guest.', NULL, 'PMS',
   'Medium', 'New', NULL, NOW() - INTERVAL '40 minutes')
ON CONFLICT (id) DO NOTHING;
