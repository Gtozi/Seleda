-- Migration 640: Executive Checklists persistence
-- Backs /erp/operations/executive-checklists (ExecutiveChecklists.tsx).
--
-- ops_exec_checklists stores recurring executive checklist templates.
-- Effective status is derived server-side from frequency vs. the current
-- period (daily = today, weekly = ISO week, monthly = calendar month):
-- completed_at within the period → 'completed', started_at within the
-- period → 'in-progress', otherwise → 'pending'. This gives automatic
-- per-period reset without scheduled jobs.

CREATE TABLE IF NOT EXISTS public.ops_exec_checklists (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  title           TEXT NOT NULL,
  frequency       TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  category        TEXT NOT NULL DEFAULT 'operational',
  assigned_to     TEXT,
  due_label       TEXT,               -- display hint, e.g. 'Today 10:00', 'Friday 16:00', 'Month End'
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  completed_by    TEXT,
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_exec_checklists_property ON public.ops_exec_checklists (property_id);

ALTER TABLE public.ops_exec_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_exec_checklists_auth ON public.ops_exec_checklists;
CREATE POLICY ops_exec_checklists_auth ON public.ops_exec_checklists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_exec_checklists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_exec_checklists TO service_role;

-- Seed: the former mock checklist items.
INSERT INTO public.ops_exec_checklists (id, title, frequency, category, assigned_to, due_label, sort_order) VALUES
  ('exc-001', 'Executive Walkthrough',    'daily',   'walkthrough',  'General Manager',      'Today 10:00',  1),
  ('exc-002', 'Lobby Inspection',         'daily',   'inspection',   'Resident Manager',     'Today 09:00',  2),
  ('exc-003', 'Public Area Inspection',   'daily',   'inspection',   'Hotel Manager',        'Today 11:00',  3),
  ('exc-004', 'Department Review',        'weekly',  'review',       'General Manager',      'Friday 16:00', 4),
  ('exc-005', 'Safety Walk',              'weekly',  'safety',       'Security Manager',     'Friday 14:00', 5),
  ('exc-006', 'Asset Inspection',         'weekly',  'inspection',   'Engineering Manager',  'Friday 15:00', 6),
  ('exc-007', 'Executive Audit',          'monthly', 'audit',        'General Manager',      'Month End',    7),
  ('exc-008', 'Compliance Review',        'monthly', 'compliance',   'Hotel Manager',        'Month End',    8),
  ('exc-009', 'Risk Assessment',          'monthly', 'compliance',   'Operations Manager',   'Month End',    9)
ON CONFLICT (id) DO NOTHING;
