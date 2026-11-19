-- ============================================================
-- Engineering Portal — Safety & Regulatory Compliance (Migration 341)
-- ============================================================
-- Backs the /erp/maintenance/compliance tab (ComplianceModule.tsx).
-- Previously the module rendered hardcoded mock data in useState. This
-- migration persists that contract to the DB so the module can
-- fetch/persist via /api/eng-portal/compliance.
--
-- A compliance item is a regulatory certificate, safety audit,
-- inspection, license, or permit tracked for expiry / renewal. It
-- flows:
--   Scheduled → In Progress → Valid → (Overdue | Expired | Failed)
--   (+ Overdue: auto-derived when a Valid/Scheduled item passes its
--    expiry_date without being renewed — enforced server-side in the
--    GET route).
-- "Convert to Work Order" creates a real row in work_orders and links
-- it back via converted_work_order_id, integrating with the Work Order
-- Management console (/erp/maintenance/workorders). Typically used when
-- an item Fails or goes Overdue and a remediation WO is needed.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_compliance_items (
  id                       TEXT PRIMARY KEY,
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  comp_number              TEXT NOT NULL,
  title                    TEXT NOT NULL,
  category                 TEXT NOT NULL CHECK (category IN (
                             'Fire Safety', 'Electrical', 'Elevator', 'Water',
                             'Gas', 'Structural', 'Mechanical', 'Environmental',
                             'General', 'Other'
                           )),
  type                     TEXT NOT NULL CHECK (type IN (
                             'Certification', 'Inspection', 'Testing', 'Audit',
                             'License', 'Permit'
                           )),
  authority                TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                             'Valid', 'Scheduled', 'In Progress', 'Overdue',
                             'Expired', 'Failed'
                           )),
  priority                 TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                             'Critical', 'High', 'Normal', 'Low'
                           )),
  certificate_number       TEXT,
  issue_date               TIMESTAMPTZ,
  expiry_date              TIMESTAMPTZ,
  last_inspected_date      TIMESTAMPTZ,
  next_inspection_date     TIMESTAMPTZ,
  responsible_person       TEXT,
  result                   TEXT,
  notes                    TEXT,
  attachments              JSONB NOT NULL DEFAULT '[]'::jsonb,
  converted_work_order_id  TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  in_progress_at           TIMESTAMPTZ,
  verified_at              TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_compliance_property
  ON public.eng_compliance_items(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_compliance_status
  ON public.eng_compliance_items(status);
CREATE INDEX IF NOT EXISTS idx_eng_compliance_category
  ON public.eng_compliance_items(category);
CREATE INDEX IF NOT EXISTS idx_eng_compliance_type
  ON public.eng_compliance_items(type);
CREATE INDEX IF NOT EXISTS idx_eng_compliance_priority
  ON public.eng_compliance_items(priority);
CREATE INDEX IF NOT EXISTS idx_eng_compliance_expiry_date
  ON public.eng_compliance_items(expiry_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_eng_compliance_items_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_compliance_items_updated_at
  ON public.eng_compliance_items;
CREATE TRIGGER trg_eng_compliance_items_updated_at
  BEFORE UPDATE ON public.eng_compliance_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_compliance_items_timestamp();

ALTER TABLE public.eng_compliance_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_compliance_items"
  ON public.eng_compliance_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_compliance_items TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The compliance items previously hardcoded as useState initial state in
-- ComplianceModule.tsx (the 4 regulatory certificates plus the fire-safety
-- and electrical sub-items shown in the UI). Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.eng_compliance_items
  (id, property_id, comp_number, title, category, type, authority, status,
   priority, certificate_number, issue_date, expiry_date, last_inspected_date,
   next_inspection_date, responsible_person, result, notes)
VALUES
  -- Main regulatory certificate tracker (from the original mock list)
  ('COMP-001', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-001',
   'Fire Safety Audit', 'Fire Safety', 'Certification', 'Civil Defense',
   'Valid', 'Critical', 'FSA-2025-CD-014', '2025-07-15', '2026-07-15',
   '2025-07-15', '2026-07-15', 'Fire Safety Officer', 'Certified',
   'Annual fire safety certification covering exits, alarms, and extinguishers.'),
  ('COMP-002', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-002',
   'Elevator Safety Check', 'Elevator', 'Inspection', 'Technical Authority',
   'Overdue', 'Critical', 'ELV-2025-TA-007', '2025-05-25', '2026-05-25',
   '2025-05-25', '2026-05-25', 'Maintenance Supervisor', 'Pending re-inspection',
   'Elevator calibration overdue. Schedule technical authority re-inspection.'),
  ('COMP-003', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-003',
   'Water Potability Report', 'Water', 'Testing', 'Health Dept',
   'Scheduled', 'High', NULL, NULL, '2026-06-05', NULL, '2026-06-05',
   'Chief Engineer', 'Scheduled',
   'Quarterly water potability testing per health department requirements.'),
  ('COMP-004', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-004',
   'Electrical Load Balancing', 'Electrical', 'Audit', 'Internal Ops',
   'Valid', 'Normal', 'ELB-2026-IO-003', '2026-02-10', '2026-08-10',
   '2026-02-10', '2026-08-10', 'Electrical Team', 'Pass',
   'Annual electrical load balancing audit for main distribution panels.'),
  -- Fire Safety Systems sub-items (from the original UI cards)
  ('COMP-005', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2025-005',
   'Fire Exits & Emergency Lights', 'Fire Safety', 'Inspection', 'Civil Defense',
   'Valid', 'High', 'FEX-2025-CD-021', '2025-10-01', '2026-10-01',
   '2025-10-01', '2026-10-01', 'Fire Safety Officer', 'Certified',
   'Emergency exits and lighting inspected and certified.'),
  ('COMP-006', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-006',
   'Fire Alarm System', 'Fire Safety', 'Testing', 'Civil Defense',
   'Valid', 'Critical', 'FAS-LIVE-001', '2026-01-01', '2027-01-01',
   '2026-08-01', '2026-09-01', 'Fire Safety Officer', 'Operational',
   'Fire alarm system live monitoring — operational status confirmed monthly.'),
  ('COMP-007', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-007',
   'Fire Extinguishers', 'Fire Safety', 'Inspection', 'Civil Defense',
   'Valid', 'High', 'FEX-2026-CD-009', '2026-01-15', '2027-01-15',
   '2026-01-15', '2027-01-15', 'Fire Safety Officer', 'Checked',
   'All fire extinguishers checked and tagged.'),
  -- Electrical Compliance sub-items (from the original UI cards)
  ('COMP-008', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-008',
   'Earth Bonding Test', 'Electrical', 'Testing', 'Internal Ops',
   'Valid', 'High', 'EBT-2026-IO-001', '2026-01-01', '2027-01-01',
   '2026-01-01', '2027-01-01', 'Electrical Team', 'Pass',
   'Annual earth bonding integrity test.'),
  ('COMP-009', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-009',
   'DB Thermography Scan', 'Electrical', 'Inspection', 'Internal Ops',
   'Valid', 'Normal', 'DBT-2026-IO-002', '2026-08-01', '2026-09-01',
   '2026-08-01', '2026-09-01', 'Electrical Team', 'Pass',
   'Monthly distribution board thermographic inspection.'),
  ('COMP-010', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-010',
   'UPS Integrity Check', 'Electrical', 'Testing', 'Internal Ops',
   'Valid', 'High', 'UPS-2026-IO-004', '2026-08-20', '2026-08-27',
   '2026-08-20', '2026-08-27', 'Electrical Team', '98%',
   'Weekly UPS integrity check — battery health at 98%.'),
  -- Additional items to enrich KPIs
  ('COMP-011', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-011',
   'Municipal Safety Audit', 'General', 'Audit', 'Municipality',
   'Scheduled', 'Critical', NULL, NULL, '2026-09-07', NULL, '2026-09-07',
   'General Manager', 'Scheduled',
   'Next major municipal safety audit — building-wide compliance review.'),
  ('COMP-012', '18762279-a389-41c9-9169-7ebc682e9703', 'COMP-2026-012',
   'Boiler Pressure Vessel License', 'Mechanical', 'License', 'Technical Authority',
   'In Progress', 'High', 'BPL-2026-TA-005', '2025-09-01', '2026-09-01',
   NULL, '2026-09-01', 'Chief Engineer', 'Pending',
   'Annual boiler pressure vessel license renewal under review.')
ON CONFLICT (id) DO NOTHING;
