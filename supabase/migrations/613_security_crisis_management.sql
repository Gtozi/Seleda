-- Migration: Security Crisis Management
-- Backs the /erp/security/crisis tab (CrisisManagement.tsx).
--
-- Two tables:
--   1. sec_crises         — crisis register (team lead, comms channel,
--                           severity, lifecycle, optional links to
--                           sec_incidents and sec_bcp_plans)
--   2. sec_crisis_updates — crisis communication + decision log,
--                           CASCADE on crisis delete. Status transitions
--                           and field changes auto-log entries.

-- ── 1. Crisis register ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_crises (
  id             TEXT PRIMARY KEY,
  property_id    UUID,
  title          TEXT NOT NULL,
  crisis_type    TEXT NOT NULL DEFAULT 'Other' CHECK (crisis_type IN (
                   'Security Threat', 'Natural Disaster', 'Public Health',
                   'Media & PR', 'Cyber Incident', 'Utility Failure',
                   'Structural', 'Civil Unrest', 'Other'
                 )),
  severity       TEXT NOT NULL DEFAULT 'High' CHECK (severity IN (
                   'Critical', 'High', 'Medium', 'Low'
                 )),
  status         TEXT NOT NULL DEFAULT 'Monitoring' CHECK (status IN (
                   'Monitoring', 'Active', 'Stabilizing', 'Resolved', 'Debrief'
                 )),
  location       TEXT,
  crisis_lead    TEXT,
  comms_channel  TEXT,
  summary        TEXT,
  incident_id    TEXT REFERENCES public.sec_incidents(id) ON DELETE SET NULL,
  bcp_plan_id    TEXT REFERENCES public.sec_bcp_plans(id) ON DELETE SET NULL,
  activated_at   TIMESTAMP WITH TIME ZONE,
  resolved_at    TIMESTAMP WITH TIME ZONE,
  created_by     TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_crises_prop ON public.sec_crises(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_crises_status ON public.sec_crises(status);
CREATE INDEX IF NOT EXISTS idx_sec_crises_incident ON public.sec_crises(incident_id);

CREATE OR REPLACE FUNCTION public.update_sec_crises_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_crises_updated_at ON public.sec_crises;
CREATE TRIGGER trigger_sec_crises_updated_at
  BEFORE UPDATE ON public.sec_crises
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_crises_timestamp();

ALTER TABLE public.sec_crises ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_crises TO authenticated;

-- ── 2. Crisis updates — comms + decision log ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_crisis_updates (
  id          TEXT PRIMARY KEY,
  crisis_id   TEXT NOT NULL REFERENCES public.sec_crises(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL DEFAULT 'Note' CHECK (update_type IN (
                'Crisis Declared', 'Team Mobilized', 'Status Update',
                'Communication', 'Decision', 'Escalation',
                'BCP Activated', 'Resolved', 'Note'
              )),
  message     TEXT NOT NULL,
  actor       TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_crisis_updates_crisis ON public.sec_crisis_updates(crisis_id);

ALTER TABLE public.sec_crisis_updates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_crisis_updates TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_crises
  (id, property_id, title, crisis_type, severity, status, location,
   crisis_lead, comms_channel, summary, incident_id, bcp_plan_id,
   activated_at, resolved_at)
VALUES
  ('CRI-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Kitchen Gas Leak — Partial Evacuation',
   'Structural', 'Critical', 'Active', 'Main Kitchen / F&B Wing',
   'Security Manager', 'Radio CH-1 + WhatsApp Crisis Group',
   'Gas smell reported in main kitchen. B2 and kitchen zones evacuated per EMG-004 playbook. Utility provider en route.',
   NULL, 'BCP-001',
   NOW() - INTERVAL '2 hours', NULL),
  ('CRI-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Data Breach Investigation',
   'Cyber Incident', 'Critical', 'Stabilizing', 'IT Systems',
   'Security Manager', 'Secure channel only',
   'Unauthorized access to PMS guest records detected by vendor SIEM. Systems isolated, forensics engaged, legal notified.',
   NULL, 'BCP-005',
   NOW() - INTERVAL '2 days', NULL),
  ('CRI-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Negative Viral Review — Social Media',
   'Media & PR', 'Medium', 'Monitoring', 'External',
   'Front Office Manager', 'Email + Management Chat',
   'Guest posted viral video alleging theft by staff. Monitoring reach; statement drafted pending investigation outcome.',
   'INC-001', NULL,
   NOW() - INTERVAL '1 day', NULL),
  ('CRI-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Storm Warning — Shelter-in-Place',
   'Natural Disaster', 'High', 'Resolved', 'Entire Property',
   'Security Manager', 'PA + Radio CH-2',
   'Severe storm warning issued. Guests sheltered in ballroom; exterior secured. Warning lifted after 4 hours.',
   NULL, 'BCP-004',
   NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days'),
  ('CRI-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Legionella Test — Cooling Tower',
   'Public Health', 'High', 'Debrief', 'Roof Plant Room',
   'Chief Engineer', 'Email + Radio CH-3',
   'Elevated Legionella reading in cooling tower. Tower isolated, hyper-chlorinated, retest passed. Debrief scheduled.',
   NULL, NULL,
   NOW() - INTERVAL '9 days', NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_crisis_updates
  (id, crisis_id, update_type, message, actor, created_at)
VALUES
  ('CRU-001', 'CRI-001', 'Crisis Declared', 'Gas leak confirmed by engineer. Crisis team activated.', 'Security Manager', NOW() - INTERVAL '2 hours'),
  ('CRU-002', 'CRI-001', 'Team Mobilized', 'Zone wardens deployed; B2 + kitchen evacuated in 9 minutes.', 'Security Manager', NOW() - INTERVAL '110 minutes'),
  ('CRU-003', 'CRI-001', 'BCP Activated', 'BCP-001 evacuation plan invoked — assembly point A headcount complete.', 'Security Manager', NOW() - INTERVAL '100 minutes'),
  ('CRU-004', 'CRI-001', 'Communication', 'GM briefed; utility provider ETA 45 min; guests relocated to lobby.', 'Duty Manager', NOW() - INTERVAL '80 minutes'),
  ('CRU-005', 'CRI-001', 'Status Update', 'Awaiting utility isolation confirmation before re-entry.', 'Chief Engineer', NOW() - INTERVAL '30 minutes'),
  ('CRU-006', 'CRI-002', 'Crisis Declared', 'Vendor SIEM flagged PII export anomaly. Breach response team convened.', 'Security Manager', NOW() - INTERVAL '2 days'),
  ('CRU-007', 'CRI-002', 'Decision', 'Decision: isolate PMS reporting replica, preserve logs for forensics.', 'IT Manager', NOW() - INTERVAL '45 hours'),
  ('CRU-008', 'CRI-002', 'BCP Activated', 'BCP-005 data breach plan invoked; legal + compliance engaged.', 'Security Manager', NOW() - INTERVAL '44 hours'),
  ('CRU-009', 'CRI-002', 'Status Update', 'Scope limited to test tenant — production records unaffected. Monitoring.', 'IT Manager', NOW() - INTERVAL '12 hours'),
  ('CRU-010', 'CRI-003', 'Crisis Declared', 'Viral post at 45k views and rising. Response team on standby.', 'Front Office Manager', NOW() - INTERVAL '1 day'),
  ('CRU-011', 'CRI-003', 'Decision', 'Decision: hold public statement until the theft investigation concludes.', 'General Manager', NOW() - INTERVAL '20 hours'),
  ('CRU-012', 'CRI-004', 'Crisis Declared', 'National weather service red warning — shelter-in-place activated.', 'Security Manager', NOW() - INTERVAL '6 days'),
  ('CRU-013', 'CRI-004', 'Resolved', 'Warning lifted. Guests released; minor pool-deck damage logged to engineering.', 'Security Manager', NOW() - INTERVAL '5 days'),
  ('CRU-014', 'CRI-005', 'Crisis Declared', 'Elevated Legionella in tower 2 sample. Water system isolated.', 'Chief Engineer', NOW() - INTERVAL '9 days'),
  ('CRU-015', 'CRI-005', 'Resolved', 'Retest after hyper-chlorination passed. Tower returned to service.', 'Chief Engineer', NOW() - INTERVAL '2 days')
ON CONFLICT (id) DO NOTHING;
