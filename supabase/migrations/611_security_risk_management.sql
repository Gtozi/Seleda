-- Migration: Security Risk Management
-- Backs the /erp/security/risk tab (RiskManagement.tsx).
--
-- Two tables:
--   1. sec_risks        — enterprise risk register with likelihood × impact
--                         scoring (1–25; level derived server-side) and a
--                         5-status lifecycle.
--   2. sec_risk_actions — per-risk mitigation action checklist + review log,
--                         CASCADE on risk delete.

-- ── 1. Risk register ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_risks (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  title           TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL DEFAULT 'Operational' CHECK (category IN (
                    'Physical Security', 'Safety', 'Cyber', 'Operational',
                    'Financial', 'Compliance', 'Reputational'
                  )),
  likelihood      INTEGER NOT NULL DEFAULT 2 CHECK (likelihood BETWEEN 1 AND 5),
  impact          INTEGER NOT NULL DEFAULT 2 CHECK (impact BETWEEN 1 AND 5),
  risk_score      INTEGER NOT NULL DEFAULT 4,
  risk_level      TEXT NOT NULL DEFAULT 'Low' CHECK (risk_level IN (
                    'Low', 'Medium', 'High', 'Critical'
                  )),
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN (
                    'Open', 'Assessed', 'Mitigating', 'Monitoring', 'Closed'
                  )),
  owner           TEXT,
  mitigation_plan TEXT,
  next_review     DATE,
  identified_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMP WITH TIME ZONE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_risks_prop ON public.sec_risks(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_risks_status ON public.sec_risks(status);
CREATE INDEX IF NOT EXISTS idx_sec_risks_level ON public.sec_risks(risk_level);
CREATE INDEX IF NOT EXISTS idx_sec_risks_review ON public.sec_risks(next_review);

CREATE OR REPLACE FUNCTION public.update_sec_risks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_risks_updated_at ON public.sec_risks;
CREATE TRIGGER trigger_sec_risks_updated_at
  BEFORE UPDATE ON public.sec_risks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_risks_timestamp();

ALTER TABLE public.sec_risks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_risks TO authenticated;

-- ── 2. Mitigation actions / review log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_risk_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id     TEXT NOT NULL REFERENCES public.sec_risks(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN (
                'Mitigation Action', 'Review', 'Status Change', 'Note'
              )),
  description TEXT NOT NULL,
  owner       TEXT,
  due_date    DATE,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  actor       TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_risk_actions_risk ON public.sec_risk_actions(risk_id);

ALTER TABLE public.sec_risk_actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_risk_actions TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- risk_score = likelihood × impact; level bands: 1–4 Low, 5–9 Medium,
-- 10–15 High, 16–25 Critical.

INSERT INTO public.sec_risks
  (id, property_id, title, description, category, likelihood, impact, risk_score, risk_level,
   status, owner, mitigation_plan, next_review, identified_at, closed_at)
VALUES
  ('RSK-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Unauthorized rear entrance access',
   'Rear service entrance door propped open during deliveries; tailgating observed on two occasions.',
   'Physical Security', 4, 4, 16, 'Critical',
   'Mitigating', 'Carlos M.',
   'Install door-propped alarm, add delivery escort SOP, extend CAM-006 retention review.',
   CURRENT_DATE + INTERVAL '14 days', CURRENT_DATE - INTERVAL '10 days', NULL),
  ('RSK-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Pool area slip-and-fall incidents',
   'Two guest slip incidents near pool edge this quarter; wet-deck signage inconsistent.',
   'Safety', 4, 3, 12, 'High',
   'Mitigating', 'Elena R.',
   'Anti-slip treatment on deck edge, additional signage, hourly attendant checks logged.',
   CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE - INTERVAL '25 days', NULL),
  ('RSK-003', '18762279-a389-41c9-9169-7ebc682e9703', 'CCTV blind spot — parking level B2',
   'No camera coverage on B2 east ramp; vehicle break-in reported last month.',
   'Physical Security', 3, 4, 12, 'High',
   'Assessed', 'Security Manager',
   'Quote for additional camera + lighting upgrade requested from vendor.',
   CURRENT_DATE + INTERVAL '21 days', CURRENT_DATE - INTERVAL '15 days', NULL),
  ('RSK-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Keycard system single point of failure',
   'Access control server has no failover; outage would lock out guest floors.',
   'Operational', 2, 5, 10, 'High',
   'Open', 'Access Control Specialist',
   'Evaluate hot-standby controller and offline-override procedure.',
   CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE - INTERVAL '5 days', NULL),
  ('RSK-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Night-shift staffing shortfall',
   'Only one officer scheduled on weekend nights; two incidents exceeded response SLA.',
   'Operational', 3, 3, 9, 'Medium',
   'Mitigating', 'Security Manager',
   'Adjust rota to two officers Fri–Sun nights; interim supervisor on-call coverage.',
   CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE - INTERVAL '20 days', NULL),
  ('RSK-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Lost master key exposure',
   'Legacy master key inventory has one unaccounted key from contractor handover.',
   'Physical Security', 2, 4, 8, 'Medium',
   'Monitoring', 'Carlos M.',
   'Keyed-affected cylinders re-pinned; audit key register monthly.',
   CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE - INTERVAL '40 days', NULL),
  ('RSK-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest data exposure via Wi-Fi portal',
   'Guest Wi-Fi captive portal logs retained beyond privacy policy window.',
   'Cyber', 2, 3, 6, 'Medium',
   'Assessed', 'Security Manager',
   'Set retention to policy window; document data-flow for compliance review.',
   CURRENT_DATE + INTERVAL '45 days', CURRENT_DATE - INTERVAL '8 days', NULL),
  ('RSK-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Outdated emergency contact tree',
   'Crisis contact tree had stale numbers; corrected after last drill.',
   'Compliance', 1, 3, 3, 'Low',
   'Closed', 'Security Manager',
   'Quarterly contact-tree verification added to drill checklist.',
   NULL, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '30 days')
ON CONFLICT (id) DO NOTHING;

-- Mitigation actions / review entries (guarded for idempotent re-runs)
INSERT INTO public.sec_risk_actions (risk_id, action, description, owner, due_date, done, completed_at, actor)
SELECT * FROM (
  VALUES
    ('RSK-001', 'Mitigation Action', 'Install door-propped alarm on rear entrance', 'Engineering', CURRENT_DATE + INTERVAL '7 days', TRUE, CURRENT_DATE - INTERVAL '3 days' + TIME '15:00', 'Security Manager'),
    ('RSK-001', 'Mitigation Action', 'Publish delivery escort SOP to receiving team', 'Carlos M.', CURRENT_DATE + INTERVAL '5 days', TRUE, CURRENT_DATE - INTERVAL '5 days' + TIME '11:00', 'Carlos M.'),
    ('RSK-001', 'Mitigation Action', 'Extend CAM-006 coverage review to delivery window', 'CCTV Operator', CURRENT_DATE + INTERVAL '14 days', FALSE, NULL, 'Security Manager'),
    ('RSK-002', 'Mitigation Action', 'Apply anti-slip treatment to pool deck edge', 'Engineering', CURRENT_DATE + INTERVAL '10 days', FALSE, NULL, 'Elena R.'),
    ('RSK-002', 'Mitigation Action', 'Install additional wet-deck signage (4 locations)', 'Housekeeping', CURRENT_DATE + INTERVAL '4 days', TRUE, CURRENT_DATE - INTERVAL '2 days' + TIME '14:00', 'Elena R.'),
    ('RSK-003', 'Mitigation Action', 'Vendor quote for B2 camera + lighting', 'Security Manager', CURRENT_DATE + INTERVAL '14 days', FALSE, NULL, 'Security Manager'),
    ('RSK-003', 'Review',            'Site walk completed — B2 east ramp confirmed blind', 'Carlos M.', NULL, TRUE, CURRENT_DATE - INTERVAL '6 days' + TIME '09:00', 'Carlos M.'),
    ('RSK-004', 'Mitigation Action', 'Evaluate hot-standby access controller options', 'Access Control Specialist', CURRENT_DATE + INTERVAL '30 days', FALSE, NULL, 'Security Manager'),
    ('RSK-004', 'Mitigation Action', 'Document offline-override procedure', 'Access Control Specialist', CURRENT_DATE + INTERVAL '21 days', FALSE, NULL, 'Security Manager'),
    ('RSK-005', 'Mitigation Action', 'Revise weekend rota — two officers Fri–Sun nights', 'Security Manager', CURRENT_DATE + INTERVAL '10 days', FALSE, NULL, 'Security Manager'),
    ('RSK-006', 'Review',            'Monthly key register audit — all keys accounted', 'Carlos M.', CURRENT_DATE + INTERVAL '30 days', FALSE, NULL, 'Carlos M.'),
    ('RSK-008', 'Review',            'Contact tree verified after drill — all numbers current', 'Security Manager', NULL, TRUE, CURRENT_DATE - INTERVAL '30 days' + TIME '10:00', 'Security Manager')
) AS v(risk_id, action, description, owner, due_date, done, completed_at, actor)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sec_risk_actions a
  WHERE a.risk_id = v.risk_id AND a.description = v.description
);
