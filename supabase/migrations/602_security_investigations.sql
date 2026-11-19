-- Migration: Security Investigations
-- Backs the /erp/security/investigations tab (Investigations.tsx).
-- Mimics migrations 600/601: dept-scoped tables, property scoping, RLS +
-- authenticated CRUD grants, seed data matching the former hardcoded arrays.
--
-- Four tables:
--   1. sec_investigations           — investigation case register (links to sec_incidents)
--   2. sec_investigation_witnesses  — case witnesses
--   3. sec_investigation_evidence   — case evidence items
--   4. sec_investigation_activities — case timeline / audit trail

-- ── 1. Investigations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_investigations (
  id                TEXT PRIMARY KEY,
  property_id       UUID,
  title             TEXT NOT NULL,
  incident_id       TEXT REFERENCES public.sec_incidents(id) ON DELETE SET NULL,
  description       TEXT,
  lead_investigator TEXT,
  priority          TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN (
                      'Critical', 'High', 'Medium', 'Low'
                    )),
  status            TEXT NOT NULL DEFAULT 'Open' CHECK (status IN (
                      'Open', 'In Progress', 'Evidence Collection',
                      'Interviews', 'Analysis', 'Review', 'Closed'
                    )),
  target_date       DATE,
  created_by        TEXT,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_investigations_prop ON public.sec_investigations(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_investigations_status ON public.sec_investigations(status);
CREATE INDEX IF NOT EXISTS idx_sec_investigations_incident ON public.sec_investigations(incident_id);

CREATE OR REPLACE FUNCTION public.update_sec_investigations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_investigations_updated_at ON public.sec_investigations;
CREATE TRIGGER trigger_sec_investigations_updated_at
  BEFORE UPDATE ON public.sec_investigations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_investigations_timestamp();

ALTER TABLE public.sec_investigations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_investigations TO authenticated;

-- ── 2. Witnesses ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_investigation_witnesses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     TEXT NOT NULL REFERENCES public.sec_investigations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  contact     TEXT,
  statement   TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_inv_witnesses_case ON public.sec_investigation_witnesses(case_id);

ALTER TABLE public.sec_investigation_witnesses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_investigation_witnesses TO authenticated;

-- ── 3. Evidence ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_investigation_evidence (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      TEXT NOT NULL REFERENCES public.sec_investigations(id) ON DELETE CASCADE,
  item_type    TEXT NOT NULL DEFAULT 'Document' CHECK (item_type IN (
                 'CCTV Footage', 'Photo', 'Document', 'Statement',
                 'Log', 'Physical', 'Digital', 'Other'
               )),
  description  TEXT NOT NULL,
  collected_by TEXT,
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_inv_evidence_case ON public.sec_investigation_evidence(case_id);

ALTER TABLE public.sec_investigation_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_investigation_evidence TO authenticated;

-- ── 4. Case activities (timeline) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_investigation_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       TEXT NOT NULL REFERENCES public.sec_investigations(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL DEFAULT 'Note' CHECK (activity_type IN (
                  'Case Opened', 'Status Change', 'Witness Added',
                  'Evidence Added', 'Note', 'Case Closed'
                )),
  description   TEXT NOT NULL,
  actor         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_inv_activities_case ON public.sec_investigation_activities(case_id);

ALTER TABLE public.sec_investigation_activities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_investigation_activities TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Seeds mirror the former hardcoded array in Investigations.tsx.
-- NOTE: the mock's INV-003 referenced 'INC-006', which does not exist in
-- sec_incidents — seeded as NULL (unlinked) to preserve FK integrity.

-- 4 investigation cases
INSERT INTO public.sec_investigations
  (id, property_id, title, incident_id, description, lead_investigator, priority, status, created_at, target_date)
VALUES
  ('INV-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Theft Investigation', 'INC-001',
   'Investigation into reported laptop theft from room 312', 'John D.', 'High', 'In Progress',
   '2024-01-15'::timestamptz, '2024-01-22'),
  ('INV-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Security Breach Analysis', 'INC-004',
   'Analysis of unauthorized access attempt at rear entrance', 'Sarah L.', 'High', 'Evidence Collection',
   '2024-01-14'::timestamptz, '2024-01-21'),
  ('INV-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Employee Misconduct Review', NULL,
   'Review of reported misconduct by housekeeping staff', 'Elena R.', 'Medium', 'Interviews',
   '2024-01-13'::timestamptz, '2024-01-20'),
  ('INV-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Property Damage Assessment', 'INC-003',
   'Assessment of lobby window damage and cause determination', 'Carlos M.', 'Low', 'Closed',
   '2024-01-10'::timestamptz, '2024-01-17')
ON CONFLICT (id) DO NOTHING;

-- Witnesses (counts match the former mock: 2 / 1 / 3 / 0)
INSERT INTO public.sec_investigation_witnesses (case_id, name, contact, statement)
SELECT * FROM (VALUES
  ('INV-001', 'Maria S. (Guest, Room 314)', 'Room 314', 'Heard corridor noise around 10:30 PM.'),
  ('INV-001', 'Tom K. (Housekeeping)', 'Ext. 2214', 'Saw an unknown person near room 312 service door.'),
  ('INV-002', 'Night Guard — P. Osei', 'CH-4 Radio', 'Observed tampered lock on rear entrance during 02:00 round.'),
  ('INV-003', 'L. Bekele (HK Supervisor)', 'Ext. 3301', 'Reported schedule discrepancies on floor 4.'),
  ('INV-003', 'A. Worku (HK Staff)', 'Ext. 3302', 'Provided statement regarding supply room access.'),
  ('INV-003', 'D. Tesfaye (Shift Manager)', 'Ext. 1100', 'Confirmed shift assignments for the reported dates.')
) AS v(case_id, name, contact, statement)
WHERE EXISTS (SELECT 1 FROM public.sec_investigations i WHERE i.id = v.case_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.sec_investigation_witnesses w
    WHERE w.case_id = v.case_id AND w.name = v.name
  );

-- Evidence items (counts match the former mock: 5 / 8 / 4 / 3)
INSERT INTO public.sec_investigation_evidence (case_id, item_type, description, collected_by)
SELECT * FROM (VALUES
  ('INV-001', 'CCTV Footage', 'Floor 3 corridor footage, 22:00–23:00', 'John D.'),
  ('INV-001', 'Log', 'Door lock audit log — room 312', 'Sarah L.'),
  ('INV-001', 'Statement', 'Guest written statement', 'John D.'),
  ('INV-001', 'Photo', 'Photos of disturbed luggage area', 'John D.'),
  ('INV-001', 'Log', 'Key card issuance record', 'Front Desk'),
  ('INV-002', 'Log', 'Rear door access control logs', 'Sarah L.'),
  ('INV-002', 'CCTV Footage', 'CAM-006 rear entrance footage', 'Sarah L.'),
  ('INV-002', 'Physical', 'Fingerprint lift from door handle', 'Carlos M.'),
  ('INV-002', 'Log', 'Alarm panel event log', 'Sarah L.'),
  ('INV-002', 'Statement', 'Night guard statement', 'Sarah L.'),
  ('INV-002', 'Digital', 'Network access log export', 'IT'),
  ('INV-002', 'Photo', 'Photo of tampered lock mechanism', 'Carlos M.'),
  ('INV-002', 'Log', 'Radio transcript 01:45–02:15', 'Sarah L.'),
  ('INV-003', 'Document', 'Staff schedule records — floor 4', 'Elena R.'),
  ('INV-003', 'Document', 'Written complaint submission', 'HR'),
  ('INV-003', 'Statement', 'Interview transcript — HK staff', 'Elena R.'),
  ('INV-003', 'Log', 'HK cart inventory log', 'Elena R.'),
  ('INV-004', 'Photo', 'Lobby window damage photos', 'Carlos M.'),
  ('INV-004', 'Document', 'Maintenance inspection report', 'Engineering'),
  ('INV-004', 'Document', 'Weather report for incident date', 'Carlos M.')
) AS v(case_id, item_type, description, collected_by)
WHERE EXISTS (SELECT 1 FROM public.sec_investigations i WHERE i.id = v.case_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.sec_investigation_evidence e
    WHERE e.case_id = v.case_id AND e.description = v.description
  );

-- Timeline activities
INSERT INTO public.sec_investigation_activities (case_id, activity_type, description, actor, created_at)
SELECT * FROM (VALUES
  ('INV-001', 'Case Opened', 'Initial case registration for guest laptop theft', 'John D.', '2024-01-15 09:00'::timestamptz),
  ('INV-001', 'Status Change', 'Status changed to In Progress — CCTV review started', 'John D.', '2024-01-15 14:30'::timestamptz),
  ('INV-001', 'Evidence Added', 'Floor 3 corridor footage collected', 'John D.', '2024-01-16 10:00'::timestamptz),
  ('INV-002', 'Case Opened', 'Initial case registration for rear entrance breach', 'Sarah L.', '2024-01-14 08:00'::timestamptz),
  ('INV-002', 'Status Change', 'Status changed to Evidence Collection', 'Sarah L.', '2024-01-14 15:00'::timestamptz),
  ('INV-003', 'Case Opened', 'Initial case registration for misconduct review', 'Elena R.', '2024-01-13 10:00'::timestamptz),
  ('INV-003', 'Status Change', 'Status changed to Interviews — witness schedule set', 'Elena R.', '2024-01-15 09:00'::timestamptz),
  ('INV-004', 'Case Opened', 'Initial case registration for lobby window damage', 'Carlos M.', '2024-01-10 09:00'::timestamptz),
  ('INV-004', 'Case Closed', 'Case closed — accidental damage, vendor quote requested', 'Carlos M.', '2024-01-17 16:00'::timestamptz)
) AS v(case_id, activity_type, description, actor, created_at)
WHERE EXISTS (SELECT 1 FROM public.sec_investigations i WHERE i.id = v.case_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.sec_investigation_activities a
    WHERE a.case_id = v.case_id AND a.description = v.description
  );
