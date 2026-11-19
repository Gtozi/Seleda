-- Migration 116: Sales Activities
-- Tracks calls, meetings, site inspections, follow-ups, and tasks for the Sales CRM.

-- =============================================================
-- 1. Sales Activities table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_activities (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  activity_type text NOT NULL,
  title text NOT NULL,
  related_to text,
  assigned_to text,
  due_date date,
  status text DEFAULT 'Pending',
  priority text DEFAULT 'Medium',
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_activities_updated_at ON public.sales_activities;
CREATE TRIGGER trg_sales_activities_updated_at
  BEFORE UPDATE ON public.sales_activities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_activities_status ON public.sales_activities(status);
CREATE INDEX IF NOT EXISTS idx_sales_activities_due_date ON public.sales_activities(due_date);
CREATE INDEX IF NOT EXISTS idx_sales_activities_assigned_to ON public.sales_activities(assigned_to);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_activities (id, activity_type, title, related_to, assigned_to, due_date, status, priority, notes, created_by) VALUES
  ('mock-activity-001', 'Call', 'Follow-up call with Ethiopian Airlines', 'Ethiopian Airlines', 'Meron Tadesse', '2026-09-10', 'Pending', 'High', 'Discuss Q4 corporate rates and block options.', 'system'),
  ('mock-activity-002', 'Meeting', 'Contract negotiation with AAC', 'Addis Ababa City Administration', 'Dawit Hailu', '2026-09-12', 'Pending', 'High', 'Finalize AU Summit contract clauses.', 'system'),
  ('mock-activity-003', 'Site Inspection', 'Site visit for TechCorp retreat', 'TechCorp Ethiopia', 'Hiwot Girma', '2026-09-15', 'Pending', 'Medium', 'Show conference rooms and team building areas.', 'system'),
  ('mock-activity-004', 'Client Visit', 'Sunshine Travel roadshow meeting', 'Sunshine Travel Agency', 'Yonas Bekele', '2026-09-18', 'Pending', 'Medium', 'Present new packages and commission updates.', 'system'),
  ('mock-activity-005', 'Follow-up', 'Chase TechCorp proposal feedback', 'TechCorp Ethiopia', 'Sara Lemma', '2026-09-11', 'Overdue', 'High', 'Proposal sent on Aug 20, no response yet.', 'system'),
  ('mock-activity-006', 'Task', 'Prepare Royal Events quotation', 'Royal Events PLC', 'Kirubel Alemu', '2026-09-14', 'Pending', 'Low', 'Need banquet pricing and AV options.', 'system'),
  ('mock-activity-007', 'Call', 'Welcome call to Dream Wedding Planners', 'Dream Wedding Planners', 'Meron Tadesse', '2026-09-08', 'Completed', 'Low', 'Introduced venue and package overview.', 'system'),
  ('mock-activity-008', 'Meeting', 'Horizon Tours rate review', 'Horizon Tours PLC', 'Dawit Hailu', '2026-09-09', 'Completed', 'Medium', 'Updated net rates and payment terms.', 'system')
ON CONFLICT (id) DO NOTHING;
