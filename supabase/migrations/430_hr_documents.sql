-- HR Document Management
-- Generic document table supporting contracts, personal docs, certifications and payroll docs.

-- ============================================================================
-- hr_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  doc_type          TEXT NOT NULL DEFAULT 'contract'
                        CHECK (doc_type IN ('contract', 'personal', 'certification', 'payroll')),
  employee          TEXT,
  document_name     TEXT NOT NULL,
  category          TEXT,
  document_number   TEXT,
  start_date        DATE,
  end_date          DATE,
  issued_date       DATE,
  issue_date        DATE,
  expiry_date       DATE,
  generated_date    DATE,
  version           TEXT,
  status            TEXT NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Active', 'Renewed', 'Valid', 'Expiring Soon', 'Expired', 'Available', 'Archived')),
  last_updated      DATE,
  period            TEXT,
  issuing_organization TEXT,
  reason            TEXT,
  file_url          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_documents_property ON hr_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_documents_type ON hr_documents(doc_type);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_documents_updated_at ON hr_documents;
CREATE TRIGGER hr_documents_updated_at
  BEFORE UPDATE ON hr_documents
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_documents TO authenticated;

ALTER TABLE hr_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_documents_read ON hr_documents;
CREATE POLICY hr_documents_read ON hr_documents
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_documents_write ON hr_documents;
CREATE POLICY hr_documents_write ON hr_documents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hr_documents WHERE property_id = v_main) THEN
    INSERT INTO hr_documents (property_id, doc_type, employee, document_name, category, document_number, start_date, end_date, issued_date, issue_date, expiry_date, generated_date, version, status, last_updated, period, issuing_organization)
    VALUES
      -- Contracts
      (v_main, 'contract', 'Sarah Johnson',   'Employment Contract', 'Contract',       NULL, '2021-03-12', '2024-03-12', NULL, NULL, NULL, NULL, '2.0', 'Active',  '2023-03-12', NULL, NULL),
      (v_main, 'contract', 'Robert Wilson',   'Employment Contract', 'Contract',       NULL, '2020-11-05', '2023-11-05', NULL, NULL, NULL, NULL, '3.0', 'Renewed', '2023-11-05', NULL, NULL),
      (v_main, 'contract', 'Elena Martinez',  'Employment Contract', 'Contract',       NULL, '2022-01-20', '2025-01-20', NULL, NULL, NULL, NULL, '1.0', 'Active',  '2022-01-20', NULL, NULL),
      -- Personal
      (v_main, 'personal', 'John Doe',        'Passport',            'Identification', 'A12345678',  NULL, NULL, '2020-06-15', NULL, '2025-06-15', NULL, NULL, 'Valid',        NULL, NULL, NULL),
      (v_main, 'personal', 'Maria Garcia',    'National ID',         'Identification', 'ID98765432', NULL, NULL, '2019-03-20', NULL, '2029-03-20', NULL, NULL, 'Valid',        NULL, NULL, NULL),
      (v_main, 'personal', 'Carlos Ray',      'Work Permit',         'Legal',          'WP54321678', NULL, NULL, '2022-08-30', NULL, '2024-08-30', NULL, NULL, 'Expiring Soon',NULL, NULL, NULL),
      (v_main, 'personal', 'Elena Smith',     'Visa',                'Legal',          'VISA87654321',NULL,NULL, '2022-07-15', NULL, '2024-07-15', NULL, NULL, 'Expiring Soon',NULL, NULL, NULL),
      -- Certifications
      (v_main, 'certification', 'Sarah Johnson',  'Hotel Management Certification',    'Professional', NULL, NULL, NULL, NULL, '2020-08-15', '2025-08-15', NULL, NULL, 'Valid',         NULL, NULL, 'American Hotel & Lodging Association'),
      (v_main, 'certification', 'Elena Martinez', 'Food Safety Manager Certification', 'Safety',       NULL, NULL, NULL, NULL, '2021-11-20', '2024-11-20', NULL, NULL, 'Expiring Soon', NULL, NULL, 'ServSafe'),
      (v_main, 'certification', 'Robert Wilson',  'Electrical License',                'Technical',    NULL, NULL, NULL, NULL, '2018-03-10', '2024-03-10', NULL, NULL, 'Expired',       NULL, NULL, 'State Electrical Board'),
      (v_main, 'certification', 'James Chen',     'First Aid & CPR',                   'Safety',       NULL, NULL, NULL, NULL, '2023-09-01', '2025-09-01', NULL, NULL, 'Valid',         NULL, NULL, 'Red Cross'),
      -- Payroll
      (v_main, 'payroll', 'All Employees', 'Payroll Summary',   'Report',  NULL, NULL, NULL, NULL, NULL, NULL, '2024-06-28', NULL, 'Available', NULL, 'June 2024', NULL),
      (v_main, 'payroll', 'All Employees', 'Tax Summary',       'Tax',     NULL, NULL, NULL, NULL, NULL, NULL, '2024-06-30', NULL, 'Available', NULL, 'Q2 2024',   NULL),
      (v_main, 'payroll', 'All Employees', 'Benefits Statement','Benefits',NULL, NULL, NULL, NULL, NULL, NULL, '2024-01-15', NULL, 'Available', NULL, '2024',      NULL);
  END IF;
END $$;
