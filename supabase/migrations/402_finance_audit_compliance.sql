-- ============================================================
-- Finance — Audit & Compliance
-- (Migration 402)
-- ============================================================
-- Brings /erp/finance/audit_compliance fully online.
-- The audit_logs table already exists (property-scoped, seeded by app).
-- This migration creates:
--   • fin_compliance_issues   — internal compliance findings
--   • fin_journal_approvals   — journal entry approval workflow
--   • fin_external_audits     — external audit engagements
--   • fin_sod_rules           — segregation of duties rules & conflicts
-- All tables are RLS-enabled and seeded with demo rows.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_compliance_issues
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_compliance_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  issue_number text,
  type text NOT NULL DEFAULT 'regulatory' CHECK (type IN (
    'security','performance','data_quality','regulatory'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'critical','high','medium','low'
  )),
  title text NOT NULL,
  description text,
  remediation_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','in_progress','resolved'
  )),
  assigned_to text,
  resolved_by text,
  resolved_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ci_property ON public.fin_compliance_issues(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ci_status ON public.fin_compliance_issues(status);
CREATE INDEX IF NOT EXISTS idx_fin_ci_severity ON public.fin_compliance_issues(severity);
CREATE INDEX IF NOT EXISTS idx_fin_ci_type ON public.fin_compliance_issues(type);

ALTER TABLE public.fin_compliance_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_compliance_issues" ON public.fin_compliance_issues;
CREATE POLICY "authenticated can CRUD fin_compliance_issues" ON public.fin_compliance_issues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_compliance_issues" ON public.fin_compliance_issues;
CREATE POLICY "service_role all fin_compliance_issues" ON public.fin_compliance_issues
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_compliance_issues TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_journal_approvals
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_journal_approvals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  journal_number text NOT NULL,
  description text,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN (
    'Pending','Approved','Rejected'
  )),
  period text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ja_property ON public.fin_journal_approvals(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ja_status ON public.fin_journal_approvals(status);
CREATE INDEX IF NOT EXISTS idx_fin_ja_journal ON public.fin_journal_approvals(journal_number);

ALTER TABLE public.fin_journal_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_journal_approvals" ON public.fin_journal_approvals;
CREATE POLICY "authenticated can CRUD fin_journal_approvals" ON public.fin_journal_approvals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_journal_approvals" ON public.fin_journal_approvals;
CREATE POLICY "service_role all fin_journal_approvals" ON public.fin_journal_approvals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_journal_approvals TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_external_audits
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_external_audits (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  audit_number text,
  firm text NOT NULL,
  audit_type text NOT NULL DEFAULT 'Annual Financial Audit',
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
    'Scheduled','In Progress','Completed','Cancelled'
  )),
  findings_count integer NOT NULL DEFAULT 0,
  rating text CHECK (rating IN ('Excellent','Good','Fair','Poor') OR rating IS NULL),
  scope text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ea_property ON public.fin_external_audits(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ea_status ON public.fin_external_audits(status);
CREATE INDEX IF NOT EXISTS idx_fin_ea_firm ON public.fin_external_audits(firm);

ALTER TABLE public.fin_external_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_external_audits" ON public.fin_external_audits;
CREATE POLICY "authenticated can CRUD fin_external_audits" ON public.fin_external_audits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_external_audits" ON public.fin_external_audits;
CREATE POLICY "service_role all fin_external_audits" ON public.fin_external_audits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_external_audits TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. fin_sod_rules
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_sod_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  rule_name text NOT NULL,
  rule_code text,
  description text,
  duty_a text NOT NULL,
  duty_b text NOT NULL,
  conflict_level text NOT NULL DEFAULT 'Medium' CHECK (conflict_level IN (
    'Low','Medium','High'
  )),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN (
    'Active','Inactive','Violated'
  )),
  assigned_role text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_sod_property ON public.fin_sod_rules(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_sod_status ON public.fin_sod_rules(status);
CREATE INDEX IF NOT EXISTS idx_fin_sod_conflict ON public.fin_sod_rules(conflict_level);

ALTER TABLE public.fin_sod_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_sod_rules" ON public.fin_sod_rules;
CREATE POLICY "authenticated can CRUD fin_sod_rules" ON public.fin_sod_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_sod_rules" ON public.fin_sod_rules;
CREATE POLICY "service_role all fin_sod_rules" ON public.fin_sod_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_sod_rules TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. Seed data
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_property_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Compliance Issues
  INSERT INTO public.fin_compliance_issues (property_id, issue_number, type, severity, title, description, status, assigned_to) VALUES
    (v_property_id, 'CI-001', 'security', 'high', 'Weak password policy', 'Several users have passwords older than 90 days without rotation.', 'in_progress', 'IT Security'),
    (v_property_id, 'CI-002', 'data_quality', 'medium', 'Duplicate vendor records', 'Duplicate vendor entries detected in AP module requiring deduplication.', 'open', 'AP Manager'),
    (v_property_id, 'CI-003', 'regulatory', 'critical', 'Missing VAT filing deadline', 'Q1 2024 VAT filing deadline approaching without preparation.', 'resolved', 'Tax Specialist'),
    (v_property_id, 'CI-004', 'performance', 'low', 'Slow report generation', 'Monthly P&L report takes >30s to generate.', 'open', 'IT Operations')
  ON CONFLICT DO NOTHING;

  -- Journal Approvals
  INSERT INTO public.fin_journal_approvals (property_id, journal_number, description, amount, submitted_by, submitted_at, approved_by, approved_at, status) VALUES
    (v_property_id, 'JNL-2024-089', 'Monthly depreciation entry', 15000, 'John Doe', '2024-06-10T09:00:00Z', 'Jane Smith', '2024-06-11T14:00:00Z', 'Approved'),
    (v_property_id, 'JNL-2024-088', 'Office supplies expense', 8500, 'Mike Johnson', '2024-06-09T10:00:00Z', 'Sarah Wilson', '2024-06-10T15:00:00Z', 'Approved'),
    (v_property_id, 'JNL-2024-087', 'Prepaid insurance amortization', 25000, 'Emily Brown', '2024-06-08T11:00:00Z', null, null, 'Pending'),
    (v_property_id, 'JNL-2024-086', 'Utility expense accrual', 12000, 'David Lee', '2024-06-07T09:30:00Z', 'Lisa Chen', '2024-06-08T13:00:00Z', 'Approved'),
    (v_property_id, 'JNL-2024-085', 'Capital equipment purchase', 45000, 'Robert Taylor', '2024-06-06T14:00:00Z', null, null, 'Rejected')
  ON CONFLICT DO NOTHING;

  -- External Audits
  INSERT INTO public.fin_external_audits (property_id, audit_number, firm, audit_type, start_date, end_date, status, findings_count, rating) VALUES
    (v_property_id, 'EXT-2024-001', 'KPMG Ethiopia', 'Annual Financial Audit', '2024-03-01', '2024-03-31', 'Completed', 3, 'Excellent'),
    (v_property_id, 'EXT-2024-002', 'PwC Ethiopia', 'Tax Compliance Review', '2024-04-15', '2024-04-30', 'Completed', 1, 'Good'),
    (v_property_id, 'EXT-2024-003', 'Deloitte Ethiopia', 'Internal Controls Assessment', '2024-06-01', '2024-06-15', 'In Progress', 0, null),
    (v_property_id, 'EXT-2023-004', 'KPMG Ethiopia', 'Annual Financial Audit', '2023-03-01', '2023-03-31', 'Completed', 5, 'Good')
  ON CONFLICT DO NOTHING;

  -- SoD Rules
  INSERT INTO public.fin_sod_rules (property_id, rule_name, rule_code, description, duty_a, duty_b, conflict_level, status, assigned_role) VALUES
    (v_property_id, 'AP Creation vs Payment', 'SOD-001', 'User who creates vendor invoices should not approve payments.', 'Invoice Creation', 'Payment Approval', 'High', 'Active', 'Controller'),
    (v_property_id, 'Journal Entry vs Approval', 'SOD-002', 'User who posts journal entries should not approve them.', 'Journal Entry', 'Journal Approval', 'High', 'Active', 'CFO'),
    (v_property_id, 'Payroll Processing vs Distribution', 'SOD-003', 'User who processes payroll should not distribute paychecks.', 'Payroll Processing', 'Payroll Distribution', 'Medium', 'Active', 'HR Manager'),
    (v_property_id, 'Purchase Order vs Receiving', 'SOD-004', 'User who creates POs should not confirm receipt of goods.', 'Purchase Order', 'Goods Receipt', 'Medium', 'Active', 'Procurement Manager')
  ON CONFLICT DO NOTHING;
END $$;
