-- Migration: Front Office Staff Roster
-- Creates fo_staff table with FO-specific fields (station, role, shift,
-- productivity metrics) and HR employee linkage via employee_id.
-- Mirrors housekeeping_staff but tailored for Front Office operations.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS fo_staff (
  id TEXT PRIMARY KEY,
  property_id UUID,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'Front Desk Agent' CHECK (role IN (
    'Front Desk Agent', 'Concierge', 'Bell Attendant',
    'Night Auditor', 'Guest Relations', 'Cashier', 'Supervisor'
  )),
  shift TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN ('Morning', 'Evening', 'Night')),
  station TEXT NOT NULL DEFAULT 'Front Desk',
  check_ins INTEGER NOT NULL DEFAULT 0,
  check_outs INTEGER NOT NULL DEFAULT 0,
  guest_satisfaction NUMERIC(3,2) NOT NULL DEFAULT 0,
  upsell_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_response_min NUMERIC(5,2) NOT NULL DEFAULT 0,
  workload INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active Duty',
  is_active BOOLEAN NOT NULL DEFAULT true,
  employee_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fo_staff ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fo_staff_property ON fo_staff(property_id);
CREATE INDEX IF NOT EXISTS idx_fo_staff_role ON fo_staff(role);
CREATE INDEX IF NOT EXISTS idx_fo_staff_shift ON fo_staff(shift);
CREATE INDEX IF NOT EXISTS idx_fo_staff_employee ON fo_staff(employee_id);

-- ── Seed data ────────────────────────────────────────────────────────
INSERT INTO fo_staff (id, property_id, name, avatar, role, shift, station, check_ins, check_outs, guest_satisfaction, upsell_revenue, avg_response_min, workload, status, is_active)
SELECT * FROM (VALUES
  ('FO-01'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Sarah J.'::text, 'SJ'::text, 'Front Desk Agent'::text, 'Morning'::text, 'Front Desk'::text, 18::int, 12::int, 4.80::numeric, 450.00::numeric, 3.5::numeric, 75::int, 'Active Duty'::text, true),
  ('FO-02'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Michael T.'::text, 'MT'::text, 'Front Desk Agent'::text, 'Evening'::text, 'Front Desk'::text, 15::int, 10::int, 4.50::numeric, 280.00::numeric, 4.2::numeric, 65::int, 'Active Duty'::text, true),
  ('FO-03'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Emma R.'::text, 'ER'::text, 'Cashier'::text, 'Morning'::text, 'Cashier'::text, 8::int, 6::int, 4.20::numeric, 120.00::numeric, 5.0::numeric, 50::int, 'On Break'::text, true),
  ('FO-04'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'David K.'::text, 'DK'::text, 'Night Auditor'::text, 'Night'::text, 'Front Desk'::text, 3::int, 2::int, 4.60::numeric, 0.00::numeric, 2.8::numeric, 40::int, 'Active Duty'::text, true),
  ('FO-05'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Lisa M.'::text, 'LM'::text, 'Concierge'::text, 'Morning'::text, 'Concierge Desk'::text, 0::int, 0::int, 4.90::numeric, 620.00::numeric, 3.0::numeric, 45::int, 'Active Duty'::text, true),
  ('FO-06'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'James B.'::text, 'JB'::text, 'Bell Attendant'::text, 'Morning'::text, 'Bell Desk'::text, 0::int, 0::int, 4.70::numeric, 50.00::numeric, 2.5::numeric, 55::int, 'Active Duty'::text, true),
  ('FO-07'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Anna L.'::text, 'AL'::text, 'Guest Relations'::text, 'Evening'::text, 'Lobby'::text, 0::int, 0::int, 4.85::numeric, 180.00::numeric, 3.8::numeric, 60::int, 'Active Duty'::text, true),
  ('FO-08'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Robert C.'::text, 'RC'::text, 'Supervisor'::text, 'Morning'::text, 'Front Desk'::text, 5::int, 3::int, 4.60::numeric, 200.00::numeric, 3.2::numeric, 35::int, 'Active Duty'::text, true),
  ('FO-09'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Maria G.'::text, 'MG'::text, 'Front Desk Agent'::text, 'Night'::text, 'Front Desk'::text, 2::int, 1::int, 4.30::numeric, 0.00::numeric, 4.5::numeric, 30::int, 'Off Duty'::text, true),
  ('FO-10'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Kevin W.'::text, 'KW'::text, 'Bell Attendant'::text, 'Evening'::text, 'Bell Desk'::text, 0::int, 0::int, 4.40::numeric, 30.00::numeric, 3.0::numeric, 50::int, 'Active Duty'::text, true)
) AS v(id, property_id, name, avatar, role, shift, station, check_ins, check_outs, guest_satisfaction, upsell_revenue, avg_response_min, workload, status, is_active)
WHERE NOT EXISTS (SELECT 1 FROM fo_staff s WHERE s.id = v.id);
