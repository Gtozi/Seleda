-- Migration: Security Business Continuity
-- Backs the /erp/security/business-continuity tab (BusinessContinuity.tsx).
--
-- Two tables:
--   1. sec_bcp_plans      — continuity / disaster-recovery plan register
--                           (RTO/RPO objectives, activation trigger,
--                            recovery steps, test schedule, lifecycle)
--   2. sec_bcp_exercises  — plan tests/exercises log (tabletop, simulation,
--                           full test, review), CASCADE on plan delete.
--                           Completing an exercise updates the plan's
--                           last_tested / next_test_due server-side.

-- ── 1. Continuity plans ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_bcp_plans (
  id                TEXT PRIMARY KEY,
  property_id       UUID,
  title             TEXT NOT NULL,
  plan_type         TEXT NOT NULL DEFAULT 'Business Continuity' CHECK (plan_type IN (
                      'Disaster Recovery', 'Business Continuity', 'Emergency Response',
                      'IT Recovery', 'Utility Outage', 'Pandemic Response', 'Other'
                    )),
  criticality       TEXT NOT NULL DEFAULT 'Medium' CHECK (criticality IN (
                      'Critical', 'High', 'Medium', 'Low'
                    )),
  status            TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                      'Draft', 'Active', 'Under Review', 'Archived'
                    )),
  owner             TEXT,
  scope             TEXT,
  activation_trigger TEXT,
  recovery_steps    TEXT,
  rto_hours         INTEGER CHECK (rto_hours IS NULL OR rto_hours >= 0),
  rpo_hours         INTEGER CHECK (rpo_hours IS NULL OR rpo_hours >= 0),
  version           TEXT NOT NULL DEFAULT '1.0',
  last_tested       DATE,
  next_test_due     DATE,
  review_date       DATE,
  created_by        TEXT,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_bcp_plans_prop ON public.sec_bcp_plans(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_bcp_plans_status ON public.sec_bcp_plans(status);
CREATE INDEX IF NOT EXISTS idx_sec_bcp_plans_due ON public.sec_bcp_plans(next_test_due);

CREATE OR REPLACE FUNCTION public.update_sec_bcp_plans_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_bcp_plans_updated_at ON public.sec_bcp_plans;
CREATE TRIGGER trigger_sec_bcp_plans_updated_at
  BEFORE UPDATE ON public.sec_bcp_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_bcp_plans_timestamp();

ALTER TABLE public.sec_bcp_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_bcp_plans TO authenticated;

-- ── 2. Plan exercises / tests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_bcp_exercises (
  id             TEXT PRIMARY KEY,
  property_id    UUID,
  plan_id        TEXT NOT NULL REFERENCES public.sec_bcp_plans(id) ON DELETE CASCADE,
  exercise_type  TEXT NOT NULL CHECK (exercise_type IN (
                   'Tabletop', 'Simulation', 'Full Test', 'Review'
                 )),
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                   'Scheduled', 'In Progress', 'Completed', 'Cancelled'
                 )),
  result         TEXT CHECK (result IN ('Pass', 'Issues Found', 'Fail')),
  conducted_by   TEXT,
  scheduled_at   TIMESTAMP WITH TIME ZONE,
  completed_at   TIMESTAMP WITH TIME ZONE,
  participants   INTEGER,
  findings       TEXT,
  created_by     TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_bcp_ex_prop ON public.sec_bcp_exercises(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_bcp_ex_plan ON public.sec_bcp_exercises(plan_id);
CREATE INDEX IF NOT EXISTS idx_sec_bcp_ex_status ON public.sec_bcp_exercises(status);

ALTER TABLE public.sec_bcp_exercises ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_bcp_exercises TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_bcp_plans
  (id, property_id, title, plan_type, criticality, status, owner,
   scope, activation_trigger, recovery_steps, rto_hours, rpo_hours,
   version, last_tested, next_test_due, review_date)
VALUES
  ('BCP-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Property-Wide Evacuation & Relocation',
   'Emergency Response', 'Critical', 'Active', 'Security Manager',
   'Full property — guests, staff, contractors',
   'Fire alarm escalation, structural incident, or civil authority order',
   '1. Activate incident command. 2. Initiate PA evacuation per zone. 3. Sweep floors by zone wardens. 4. Muster at assembly points A/B. 5. Headcount + roll call via PMS manifest. 6. Coordinate relocation with partner hotel.',
   4, NULL, '3.2', CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE + INTERVAL '78 days', CURRENT_DATE + INTERVAL '30 days'),
  ('BCP-002', '18762279-a389-41c9-9169-7ebc682e9703', 'PMS / Systems Outage Recovery',
   'IT Recovery', 'High', 'Active', 'IT Manager',
   'PMS, POS, keycard system, Wi-Fi',
   'PMS outage > 15 min or keycard server failure',
   '1. Switch to offline mode / paper folios. 2. Manual key issuance per key register. 3. Notify vendor support (SLA 2h). 4. Restore from nightly backup if required. 5. Reconcile offline transactions.',
   2, 24, '2.1', CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE + INTERVAL '20 days', CURRENT_DATE + INTERVAL '15 days'),
  ('BCP-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Utility Outage — Power & Water',
   'Utility Outage', 'High', 'Active', 'Chief Engineer',
   'Power grid failure, water main break',
   'Utility outage > 30 min or generator fault',
   '1. Confirm generator auto-start + fuel status. 2. Isolate non-critical loads. 3. Notify guests via PA + room letters. 4. Contact utility provider for ETA. 5. Relocate guests if > 4h outage.',
   1, NULL, '2.0', CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '10 days'),
  ('BCP-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Severe Weather Shelter-in-Place',
   'Emergency Response', 'Medium', 'Under Review', 'Security Manager',
   'Storm/flood scenario — shelter guests in interior zones',
   'National weather service warning for property area',
   '1. Monitor alerts. 2. Secure exterior + pool areas. 3. Move guests to interior corridors/ballroom. 4. Stock emergency supplies. 5. Post-event damage assessment.',
   6, NULL, '1.4', CURRENT_DATE - INTERVAL '90 days', CURRENT_DATE + INTERVAL '45 days', CURRENT_DATE + INTERVAL '7 days'),
  ('BCP-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Data Breach Response',
   'Disaster Recovery', 'Critical', 'Active', 'Security Manager',
   'Guest PII, payment data, staff records',
   'Confirmed or suspected unauthorized data access',
   '1. Isolate affected systems. 2. Convene breach response team. 3. Assess scope with IT/forensics. 4. Notify compliance officer + legal. 5. Guest notification per privacy policy. 6. Post-incident review.',
   1, 4, '1.1', NULL, CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '21 days'),
  ('BCP-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Legacy Pandemic Plan (2020)',
   'Pandemic Response', 'Low', 'Archived', 'Security Manager',
   'Superseded — retained for reference',
   NULL, 'Superseded by current health-authority guidance. Do not activate.',
   24, NULL, '1.0', CURRENT_DATE - INTERVAL '400 days', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_bcp_exercises
  (id, property_id, plan_id, exercise_type, title, status, result,
   conducted_by, scheduled_at, completed_at, participants, findings)
VALUES
  ('BCE-001', '18762279-a389-41c9-9169-7ebc682e9703', 'BCP-001', 'Full Test', 'Q3 Evacuation Full Test', 'Completed', 'Issues Found',
   'Security Manager', CURRENT_DATE - INTERVAL '12 days' + TIME '10:00', CURRENT_DATE - INTERVAL '12 days' + TIME '11:30', 42,
   'Evacuation completed in 6m40s. Issues: muster point signage faded, two zone wardens absent — assign deputies.'),
  ('BCE-002', '18762279-a389-41c9-9169-7ebc682e9703', 'BCP-002', 'Tabletop', 'PMS Outage Tabletop', 'Completed', 'Pass',
   'IT Manager', CURRENT_DATE - INTERVAL '45 days' + TIME '14:00', CURRENT_DATE - INTERVAL '45 days' + TIME '15:30', 8,
   'Offline folio process validated. Front desk binder updated.'),
  ('BCE-003', '18762279-a389-41c9-9169-7ebc682e9703', 'BCP-003', 'Simulation', 'Generator Failover Simulation', 'Completed', 'Issues Found',
   'Chief Engineer', CURRENT_DATE - INTERVAL '60 days' + TIME '09:00', CURRENT_DATE - INTERVAL '60 days' + TIME '10:00', 5,
   'Generator started in 11s. Kitchen cold storage not on backup circuit — escalate to engineering project.'),
  ('BCE-004', '18762279-a389-41c9-9169-7ebc682e9703', 'BCP-001', 'Review', 'Annual Plan Review', 'Scheduled', NULL,
   'Security Manager', CURRENT_DATE + INTERVAL '30 days' + TIME '10:00', NULL, NULL,
   'Annual review — validate contact tree, zone assignments, assembly points.'),
  ('BCE-005', '18762279-a389-41c9-9169-7ebc682e9703', 'BCP-005', 'Tabletop', 'Data Breach Tabletop', 'Scheduled', NULL,
   'Security Manager', CURRENT_DATE + INTERVAL '30 days' + TIME '14:00', NULL, NULL,
   'First exercise for the breach plan — invite IT + legal + GM.'),
  ('BCE-006', '18762279-a389-41c9-9169-7ebc682e9703', 'BCP-004', 'Tabletop', 'Severe Weather Tabletop', 'Scheduled', NULL,
   'Security Manager', CURRENT_DATE + INTERVAL '14 days' + TIME '09:00', NULL, NULL,
   'Review shelter-in-place triggers and interior zone capacity.')
ON CONFLICT (id) DO NOTHING;
