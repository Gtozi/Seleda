-- Migration: Security Compliance Management
-- Backs the /erp/security/compliance tab (ComplianceManagement.tsx).
--
-- Two tables:
--   1. sec_compliance_items  — license/certification/permit register with
--                              expiry tracking; status auto-derived from
--                              expiry_date server-side (Expired < today,
--                              Expiring Soon <= 30 days)
--   2. sec_compliance_audits — internal/external/regulatory audit register

-- ── 1. Compliance items ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_compliance_items (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'Regulatory' CHECK (category IN (
                  'License', 'Certification', 'Permit', 'Regulatory',
                  'Policy', 'Training', 'Insurance', 'Other'
                )),
  authority     TEXT,
  reference_no  TEXT,
  status        TEXT NOT NULL DEFAULT 'Compliant' CHECK (status IN (
                  'Compliant', 'Pending', 'Expiring Soon', 'Expired', 'Non-Compliant'
                )),
  issue_date    DATE,
  expiry_date   DATE,
  last_audit    DATE,
  responsible   TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_compliance_prop ON public.sec_compliance_items(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_compliance_status ON public.sec_compliance_items(status);
CREATE INDEX IF NOT EXISTS idx_sec_compliance_expiry ON public.sec_compliance_items(expiry_date);

CREATE OR REPLACE FUNCTION public.update_sec_compliance_items_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_compliance_items_updated_at ON public.sec_compliance_items;
CREATE TRIGGER trigger_sec_compliance_items_updated_at
  BEFORE UPDATE ON public.sec_compliance_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_compliance_items_timestamp();

ALTER TABLE public.sec_compliance_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_compliance_items TO authenticated;

-- ── 2. Compliance audits ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_compliance_audits (
  id           TEXT PRIMARY KEY,
  property_id  UUID,
  title        TEXT NOT NULL,
  audit_type   TEXT NOT NULL DEFAULT 'Internal' CHECK (audit_type IN (
                 'Internal', 'External', 'Regulatory', 'Insurance'
               )),
  auditor      TEXT,
  scope        TEXT,
  status       TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                 'Scheduled', 'In Progress', 'Completed', 'Cancelled'
               )),
  result       TEXT CHECK (result IN ('Pass', 'Pass with Findings', 'Fail')),
  findings     TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by   TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_audits_prop ON public.sec_compliance_audits(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_audits_status ON public.sec_compliance_audits(status);

ALTER TABLE public.sec_compliance_audits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_compliance_audits TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_compliance_items
  (id, property_id, title, category, authority, reference_no, status,
   issue_date, expiry_date, last_audit, responsible, notes)
VALUES
  ('CMP-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Security Guard Agency License',
   'License', 'Ministry of Interior', 'SGA-2024-1187', 'Compliant',
   CURRENT_DATE - INTERVAL '10 months', CURRENT_DATE + INTERVAL '60 days', CURRENT_DATE - INTERVAL '6 months',
   'Security Manager', 'Annual license covering all contracted security personnel.'),
  ('CMP-002', '18762279-a389-41c9-9169-7ebc682e9703', 'CCTV Operation Permit',
   'Permit', 'City Police Authority', 'CCTV-PRM-0912', 'Expiring Soon',
   CURRENT_DATE - INTERVAL '11 months', CURRENT_DATE + INTERVAL '21 days', CURRENT_DATE - INTERVAL '11 months',
   'Security Manager', 'Renewal paperwork submitted; awaiting inspection visit.'),
  ('CMP-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Fire Safety Certificate',
   'Certification', 'Civil Defense Authority', 'FSC-4471', 'Compliant',
   CURRENT_DATE - INTERVAL '8 months', CURRENT_DATE + INTERVAL '120 days', CURRENT_DATE - INTERVAL '4 months',
   'Chief Engineer', 'Covers alarm systems, suppression, evacuation plan approval.'),
  ('CMP-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Food Handler Certifications — Security Escorts',
   'Certification', 'Health Department', NULL, 'Pending',
   NULL, NULL, NULL,
   'HR Manager', 'Two security escorts supporting banquet service pending food-handler cards.'),
  ('CMP-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Private Data Processing Registration (GDPR-equivalent)',
   'Regulatory', 'Data Protection Office', 'DPO-REG-552', 'Compliant',
   CURRENT_DATE - INTERVAL '14 months', CURRENT_DATE + INTERVAL '300 days', CURRENT_DATE - INTERVAL '2 months',
   'Security Manager', 'Guest PII, CCTV retention, and access-log processing registered.'),
  ('CMP-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Pool Lifeguard Certification',
   'Training', 'Red Cross / National Body', 'LG-2023-884', 'Expired',
   CURRENT_DATE - INTERVAL '18 months', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '18 months',
   'HR Manager', 'Two lifeguard certs lapsed — recertification course booked.'),
  ('CMP-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Nightclub/Bar Security Staffing Permit',
   'Permit', 'Liquor & Entertainment Board', 'ENT-4420', 'Compliant',
   CURRENT_DATE - INTERVAL '5 months', CURRENT_DATE + INTERVAL '215 days', CURRENT_DATE - INTERVAL '5 months',
   'Security Manager', 'Mandates minimum door staff ratio for event nights.'),
  ('CMP-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Security SOP Manual — Annual Review',
   'Policy', 'Internal', 'SOP-SEC-2025', 'Non-Compliant',
   NULL, NULL, CURRENT_DATE - INTERVAL '13 months',
   'Security Manager', 'Annual review overdue — last signed version exceeds 12-month policy window.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_compliance_audits
  (id, property_id, title, audit_type, auditor, scope, status,
   result, findings, scheduled_at, completed_at)
VALUES
  ('AUD-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Q3 Internal Security Compliance Audit',
   'Internal', 'Security Manager', 'Licenses, SOPs, key control, incident records', 'Completed', 'Pass with Findings',
   'Minor: two key register entries missing return signatures; SOP annual review flagged overdue.',
   CURRENT_DATE - INTERVAL '21 days' + TIME '09:00', CURRENT_DATE - INTERVAL '21 days' + TIME '16:00'),
  ('AUD-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Civil Defense Fire Inspection',
   'Regulatory', 'Civil Defense Inspector', 'Fire systems, exits, drill records', 'Completed', 'Pass',
   'All systems compliant. Recommended additional exit signage in B2 parking.',
   CURRENT_DATE - INTERVAL '45 days' + TIME '10:00', CURRENT_DATE - INTERVAL '45 days' + TIME '13:00'),
  ('AUD-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Insurance Security Assessment',
   'Insurance', 'External Assessor', 'CCTV coverage, safe procedures, claims history', 'Completed', 'Pass with Findings',
   'CCTV retention meets policy minimum; recommend extending vault-camera retention to 90 days.',
   CURRENT_DATE - INTERVAL '60 days' + TIME '14:00', CURRENT_DATE - INTERVAL '60 days' + TIME '17:00'),
  ('AUD-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Q4 Internal Compliance Audit',
   'Internal', 'Security Manager', 'All compliance items + audit findings follow-up', 'Scheduled', NULL,
   'Verify CCTV permit renewal and lifeguard recertification status.',
   CURRENT_DATE + INTERVAL '14 days' + TIME '09:00', NULL),
  ('AUD-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Data Protection Spot Check',
   'External', 'DPO Consultant', 'CCTV retention, access logs, guest PII handling', 'In Progress', NULL,
   'Sampling access-event retention vs registered retention policy.',
   CURRENT_DATE - INTERVAL '1 day' + TIME '10:00', NULL)
ON CONFLICT (id) DO NOTHING;
