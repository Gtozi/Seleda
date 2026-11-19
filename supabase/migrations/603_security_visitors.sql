-- Migration: Security Visitor Management
-- Backs the /erp/security/visitors tab (VisitorManagement.tsx).
-- Mimics migrations 600-602: dept-scoped table, property scoping, RLS +
-- authenticated CRUD grants, seed data matching the former hardcoded array.
--
-- One table:
--   sec_visitors — visitor register (pre-registration, check-in/out, badges,
--                  blacklist status)

CREATE TABLE IF NOT EXISTS public.sec_visitors (
  id                    TEXT PRIMARY KEY,
  property_id           UUID,
  name                  TEXT NOT NULL,
  company               TEXT,
  visitor_type          TEXT NOT NULL DEFAULT 'General Visitor' CHECK (visitor_type IN (
                          'Contractor', 'Vendor', 'Interview Candidate',
                          'Delivery Personnel', 'Government Official',
                          'VIP Visitor', 'General Visitor'
                        )),
  host                  TEXT,
  purpose               TEXT,
  status                TEXT NOT NULL DEFAULT 'Pre-registered' CHECK (status IN (
                          'Pre-registered', 'Checked In', 'Checked Out',
                          'Blacklisted', 'Expired'
                        )),
  badge_number          TEXT,
  phone                 TEXT,
  email                 TEXT,
  expected_arrival_at   TIMESTAMP WITH TIME ZONE,
  expected_departure_at TIMESTAMP WITH TIME ZONE,
  check_in_at           TIMESTAMP WITH TIME ZONE,
  check_out_at          TIMESTAMP WITH TIME ZONE,
  blacklist_status      TEXT NOT NULL DEFAULT 'Clear',
  created_by            TEXT,
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_visitors_prop ON public.sec_visitors(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_visitors_status ON public.sec_visitors(status);
CREATE INDEX IF NOT EXISTS idx_sec_visitors_type ON public.sec_visitors(visitor_type);

CREATE OR REPLACE FUNCTION public.update_sec_visitors_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_visitors_updated_at ON public.sec_visitors;
CREATE TRIGGER trigger_sec_visitors_updated_at
  BEFORE UPDATE ON public.sec_visitors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_visitors_timestamp();

ALTER TABLE public.sec_visitors ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_visitors TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Seeds mirror the former hardcoded array in VisitorManagement.tsx.

INSERT INTO public.sec_visitors
  (id, property_id, name, company, visitor_type, host, purpose, status,
   badge_number, check_in_at, check_out_at, expected_departure_at, blacklist_status)
VALUES
  ('VIS-001', '18762279-a389-41c9-9169-7ebc682e9703', 'John Smith', 'ABC Construction', 'Contractor',
   'Carlos M.', 'Building maintenance', 'Checked In', 'BG-2024-001',
   '2024-01-15 08:30'::timestamptz, NULL, '2024-01-15 17:00'::timestamptz, 'Clear'),
  ('VIS-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Mary Johnson', 'Tech Solutions Inc', 'Vendor',
   'Elena R.', 'Equipment delivery', 'Checked Out', 'BG-2024-002',
   '2024-01-15 09:00'::timestamptz, '2024-01-15 10:30'::timestamptz, '2024-01-15 10:00'::timestamptz, 'Clear'),
  ('VIS-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Robert Davis', 'City Inspector Office', 'Government Official',
   'John D.', 'Safety inspection', 'Checked In', 'BG-2024-003',
   '2024-01-15 10:00'::timestamptz, NULL, '2024-01-15 14:00'::timestamptz, 'Clear'),
  ('VIS-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Sarah Wilson', 'Self-employed', 'Interview Candidate',
   'HR Department', 'Job interview', 'Checked Out', 'BG-2024-004',
   '2024-01-14 14:00'::timestamptz, '2024-01-14 15:30'::timestamptz, '2024-01-14 15:00'::timestamptz, 'Clear'),
  ('VIS-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Michael Brown', 'XYZ Logistics', 'Delivery Personnel',
   'Receiving', 'Package delivery', 'Blacklisted', 'BG-2024-005',
   '2024-01-10 11:00'::timestamptz, '2024-01-10 11:30'::timestamptz, '2024-01-10 11:30'::timestamptz,
   'Blacklisted - Security violation')
ON CONFLICT (id) DO NOTHING;
