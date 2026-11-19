-- Migration: Security Access Control (access grants)
-- Backs the /erp/security/access-control tab (AccessControl.tsx).
-- Mimics migrations 600-603: dept-scoped table, property scoping, RLS +
-- authenticated CRUD grants, seed data matching the former hardcoded array.
--
-- NOTE: this is the access *permissions* register (who can open which doors),
-- distinct from sec_access_events (the SOC access event log).
--
-- One table:
--   sec_access_grants — access credentials/permissions per user

CREATE TABLE IF NOT EXISTS public.sec_access_grants (
  id             TEXT PRIMARY KEY,
  property_id    UUID,
  user_ref       TEXT,                          -- employee/contractor ref e.g. EMP-001
  user_name      TEXT NOT NULL,
  access_type    TEXT NOT NULL DEFAULT 'Employee Access' CHECK (access_type IN (
                   'Employee Access', 'Guest Access', 'Contractor Access',
                   'Temporary Access', 'Emergency Access'
                 )),
  role           TEXT,
  zones          TEXT[] NOT NULL DEFAULT '{}',  -- access zone names
  door_count     INTEGER NOT NULL DEFAULT 0,
  schedule       TEXT NOT NULL DEFAULT '24-7' CHECK (schedule IN (
                   '24-7', 'business', 'dayshift', 'nightshift', 'custom'
                 )),
  status         TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                   'Active', 'Inactive', 'Suspended', 'Expired', 'Revoked'
                 )),
  valid_from     DATE,
  valid_until    DATE,
  last_access_at TIMESTAMP WITH TIME ZONE,
  access_count   INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_access_grants_prop ON public.sec_access_grants(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_access_grants_status ON public.sec_access_grants(status);
CREATE INDEX IF NOT EXISTS idx_sec_access_grants_type ON public.sec_access_grants(access_type);

CREATE OR REPLACE FUNCTION public.update_sec_access_grants_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_access_grants_updated_at ON public.sec_access_grants;
CREATE TRIGGER trigger_sec_access_grants_updated_at
  BEFORE UPDATE ON public.sec_access_grants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_access_grants_timestamp();

ALTER TABLE public.sec_access_grants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_access_grants TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Seeds mirror the former hardcoded array in AccessControl.tsx.

INSERT INTO public.sec_access_grants
  (id, property_id, user_ref, user_name, access_type, role, zones, door_count,
   status, valid_from, valid_until, last_access_at, access_count)
VALUES
  ('AGR-001', '18762279-a389-41c9-9169-7ebc682e9703', 'EMP-001', 'John D.', 'Employee Access', 'Security Officer',
   ARRAY['All Public Areas', 'Guest Floors', 'Security Office'], 15, 'Active',
   '2024-01-01', '2025-01-01', '2024-01-15 10:30'::timestamptz, 234),
  ('AGR-002', '18762279-a389-41c9-9169-7ebc682e9703', 'EMP-002', 'Elena R.', 'Employee Access', 'Security Officer',
   ARRAY['All Public Areas', 'Pool Area', 'Garden'], 12, 'Active',
   '2024-01-01', '2025-01-01', '2024-01-15 09:45'::timestamptz, 189),
  ('AGR-003', '18762279-a389-41c9-9169-7ebc682e9703', 'CON-001', 'ABC Construction', 'Contractor Access', 'Contractor',
   ARRAY['Maintenance Area', 'Boiler Room', 'Loading Dock'], 5, 'Active',
   '2024-01-10', '2024-01-20', '2024-01-15 08:00'::timestamptz, 45),
  ('AGR-004', '18762279-a389-41c9-9169-7ebc682e9703', 'GST-001', 'Guest Room 312', 'Guest Access', 'Guest',
   ARRAY['Guest Room 312', 'Guest Floor 3', 'Public Areas'], 3, 'Active',
   '2024-01-14', '2024-01-16', '2024-01-15 11:00'::timestamptz, 12),
  ('AGR-005', '18762279-a389-41c9-9169-7ebc682e9703', 'EMP-003', 'Former Employee', 'Employee Access', 'Housekeeping',
   ARRAY['All Guest Floors', 'Housekeeping Storage'], 20, 'Revoked',
   '2023-01-01', '2024-01-01', '2024-01-01 17:00'::timestamptz, 1520)
ON CONFLICT (id) DO NOTHING;
