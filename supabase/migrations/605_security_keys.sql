-- Migration: Security Key & Keycard Management
-- Backs the /erp/security/keys tab (KeyKeycardManagement.tsx).
-- Mimics migrations 600-604: dept-scoped tables, property scoping, RLS +
-- authenticated CRUD grants, seed data matching the former hardcoded array.
--
-- Two tables:
--   1. sec_keys      — physical key / electronic keycard register
--   2. sec_key_logs  — per-key audit trail (issue/return/lost/found events)

-- ── 1. Keys ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_keys (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  key_type        TEXT NOT NULL DEFAULT 'Department Key' CHECK (key_type IN (
                    'Master Key', 'Department Key', 'Emergency Key', 'Spare Key',
                    'Guest Keycard', 'Mobile Key', 'Staff Card', 'Contractor Card'
                  )),
  key_number      TEXT NOT NULL,
  assigned_to     TEXT,
  department      TEXT,
  access_level    TEXT,
  status          TEXT NOT NULL DEFAULT 'Available' CHECK (status IN (
                    'Issued', 'Available', 'Lost', 'Damaged',
                    'Inactive', 'Decommissioned'
                  )),
  issued_date     DATE,
  return_date     DATE,
  last_audit_date DATE,
  location        TEXT,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_keys_number ON public.sec_keys(key_number);
CREATE INDEX IF NOT EXISTS idx_sec_keys_prop ON public.sec_keys(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_keys_status ON public.sec_keys(status);
CREATE INDEX IF NOT EXISTS idx_sec_keys_type ON public.sec_keys(key_type);

CREATE OR REPLACE FUNCTION public.update_sec_keys_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_keys_updated_at ON public.sec_keys;
CREATE TRIGGER trigger_sec_keys_updated_at
  BEFORE UPDATE ON public.sec_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_keys_timestamp();

ALTER TABLE public.sec_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_keys TO authenticated;

-- ── 2. Key audit logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_key_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id     TEXT NOT NULL REFERENCES public.sec_keys(id) ON DELETE CASCADE,
  action     TEXT NOT NULL DEFAULT 'Note' CHECK (action IN (
               'Registered', 'Issued', 'Returned', 'Reported Lost',
               'Reported Found', 'Marked Damaged', 'Decommissioned',
               'Audited', 'Edited', 'Note'
             )),
  detail     TEXT,
  actor      TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_key_logs_key ON public.sec_key_logs(key_id);

ALTER TABLE public.sec_key_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_key_logs TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Seeds mirror the former hardcoded array in KeyKeycardManagement.tsx.

INSERT INTO public.sec_keys
  (id, property_id, key_type, key_number, assigned_to, department, access_level,
   status, issued_date, return_date, last_audit_date, location)
VALUES
  ('KEY-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Master Key', 'MK-001', 'John D.', 'Security',
   'Full Property', 'Issued', '2024-01-01', NULL, '2024-01-15', 'Security Office'),
  ('KEY-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Master Key', 'MK-002', 'Elena R.', 'Security',
   'Full Property', 'Issued', '2024-01-01', NULL, '2024-01-15', 'Security Office'),
  ('KEY-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Department Key', 'HK-001', 'Housekeeping Supervisor', 'Housekeeping',
   'All Guest Rooms', 'Issued', '2024-01-01', NULL, '2024-01-15', 'Housekeeping Office'),
  ('KEY-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Emergency Key', 'EM-001', NULL, 'General',
   'All Areas', 'Available', NULL, NULL, '2024-01-15', 'Security Safe'),
  ('KEY-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Keycard', 'GC-2024-001', 'Guest Room 312', 'Front Desk',
   'Room 312', 'Issued', '2024-01-14', '2024-01-16', '2024-01-15', 'Guest Room 312'),
  ('KEY-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Staff Card', 'SC-001', 'Carlos M.', 'Maintenance',
   'Maintenance Areas', 'Issued', '2024-01-01', NULL, '2024-01-15', 'Maintenance Office'),
  ('KEY-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Keycard', 'GC-2024-002', NULL, 'Front Desk',
   'Room 205', 'Lost', '2024-01-10', NULL, '2024-01-12', 'Unknown')
ON CONFLICT (id) DO NOTHING;

-- Audit log seeds (one entry per key registration + the reported-lost event)
INSERT INTO public.sec_key_logs (key_id, action, detail, actor, created_at)
SELECT * FROM (VALUES
  ('KEY-001', 'Registered', 'Key added to register', 'Carlos M.', '2024-01-01 08:00'::timestamptz),
  ('KEY-001', 'Issued', 'Issued to John D. — full property access', 'Carlos M.', '2024-01-01 08:05'::timestamptz),
  ('KEY-002', 'Registered', 'Key added to register', 'Carlos M.', '2024-01-01 08:00'::timestamptz),
  ('KEY-002', 'Issued', 'Issued to Elena R. — full property access', 'Carlos M.', '2024-01-01 08:10'::timestamptz),
  ('KEY-003', 'Registered', 'Key added to register', 'Carlos M.', '2024-01-01 08:00'::timestamptz),
  ('KEY-004', 'Registered', 'Emergency key secured in Security Safe', 'Carlos M.', '2024-01-01 08:00'::timestamptz),
  ('KEY-005', 'Issued', 'Issued to Guest Room 312 — checkout 2024-01-16', 'Front Desk', '2024-01-14 14:00'::timestamptz),
  ('KEY-006', 'Issued', 'Issued to Carlos M. — maintenance areas', 'Security Office', '2024-01-01 08:30'::timestamptz),
  ('KEY-007', 'Issued', 'Issued to Guest Room 205', 'Front Desk', '2024-01-10 15:00'::timestamptz),
  ('KEY-007', 'Reported Lost', 'Guest reported keycard lost at checkout', 'Front Desk', '2024-01-12 11:00'::timestamptz)
) AS v(key_id, action, detail, actor, created_at)
WHERE EXISTS (SELECT 1 FROM public.sec_keys k WHERE k.id = v.key_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.sec_key_logs l
    WHERE l.key_id = v.key_id AND l.action = v.action AND l.detail = v.detail
  );
