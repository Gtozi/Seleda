-- Migration: Security Emergency Management
-- Backs the /erp/security/emergency tab (EmergencyManagement.tsx).
--
-- Extends the shared `sec_emergency_notifications` table (single source of
-- truth with the SOC emergency tab, migration 600) with incident-command
-- fields, and adds `sec_emergency_responses` — a real response-action log
-- (dispatch, evacuation orders, status updates, all-clear).

-- ── 1. Extend sec_emergency_notifications ────────────────────────────────
ALTER TABLE public.sec_emergency_notifications
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS commander        TEXT,
  ADD COLUMN IF NOT EXISTS response_team    TEXT,
  ADD COLUMN IF NOT EXISTS evacuation       TEXT NOT NULL DEFAULT 'Not Required'
                    CHECK (evacuation IN ('Not Required', 'Standby', 'In Progress', 'Complete')),
  ADD COLUMN IF NOT EXISTS resolved_at      TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_sec_emergency_priority ON public.sec_emergency_notifications(priority);

CREATE OR REPLACE FUNCTION public.update_sec_emergency_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_emergency_updated_at ON public.sec_emergency_notifications;
CREATE TRIGGER trigger_sec_emergency_updated_at
  BEFORE UPDATE ON public.sec_emergency_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_emergency_timestamp();

-- ── 2. Emergency response log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_emergency_responses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id TEXT NOT NULL REFERENCES public.sec_emergency_notifications(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN (
                 'Alert Raised', 'Team Dispatched', 'Commander Assigned',
                 'Evacuation Ordered', 'Evacuation Complete',
                 'Status Update', 'All Clear', 'Resolved', 'Note'
               )),
  detail       TEXT,
  actor        TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_emergency_resp_emg ON public.sec_emergency_responses(emergency_id);

ALTER TABLE public.sec_emergency_responses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_emergency_responses TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Backfills command fields on the existing SOC emergency rows and adds two
-- more incidents (one resolved) plus response-log entries.

UPDATE public.sec_emergency_notifications SET
  description   = 'Kitchen grease fire — suppression system activated. Fire brigade en route.',
  commander     = 'Carlos M.',
  response_team = 'Security Team A, Fire Marshal, Engineering',
  evacuation    = 'In Progress'
WHERE id = 'EMG-001' AND commander IS NULL;

UPDATE public.sec_emergency_notifications SET
  description   = 'Guest medical incident at pool — paramedics notified, first aid in progress.',
  commander     = 'Elena R.',
  response_team = 'Security Team B, First Aiders',
  evacuation    = 'Not Required'
WHERE id = 'EMG-002' AND commander IS NULL;

UPDATE public.sec_emergency_notifications SET
  description   = 'Quarterly evacuation drill — all areas. Scheduled per compliance calendar.',
  commander     = 'Security Manager',
  response_team = 'All security staff, fire wardens',
  evacuation    = 'Standby'
WHERE id = 'EMG-003' AND commander IS NULL;

-- Two additional incidents
INSERT INTO public.sec_emergency_notifications
  (id, property_id, emergency_type, location, status, priority, occurred_at,
   description, commander, response_team, evacuation, resolved_at)
VALUES
  ('EMG-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Gas Leak', 'Basement - Boiler Room', 'Resolved', 'Critical',
   CURRENT_DATE - INTERVAL '1 day' + TIME '16:20',
   'Gas odor reported near boiler room. Area evacuated, gas isolated, ventilation confirmed by Engineering.',
   'Carlos M.', 'Engineering, Security Team A', 'Complete', CURRENT_DATE - INTERVAL '1 day' + TIME '18:05'),
  ('EMG-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Power Outage', 'Entire Property', 'Active', 'High',
   CURRENT_DATE + TIME '11:10',
   'Partial power loss — backup generators online. Elevators on emergency power. ETA on mains unknown.',
   'Duty Officer', 'Engineering, All security staff', 'Not Required', NULL)
ON CONFLICT (id) DO NOTHING;

-- Response log entries (guarded for idempotent re-runs)
INSERT INTO public.sec_emergency_responses (emergency_id, action, detail, actor, created_at)
SELECT * FROM (
  VALUES
    ('EMG-001', 'Alert Raised',        'Kitchen fire alarm triggered — smoke confirmed on CAM-K2', 'Fire Panel', CURRENT_DATE + TIME '09:30'),
    ('EMG-001', 'Team Dispatched',     'Security Team A + Fire Marshal to kitchen', 'SOC Operator', CURRENT_DATE + TIME '09:33'),
    ('EMG-001', 'Evacuation Ordered',  'Kitchen + adjacent restaurant seating evacuated', 'Carlos M.', CURRENT_DATE + TIME '09:38'),
    ('EMG-002', 'Alert Raised',        'Guest collapse reported at pool — lifeguard on scene', 'Pool Attendant', CURRENT_DATE + TIME '09:30'),
    ('EMG-002', 'Team Dispatched',     'First aiders + paramedics called', 'SOC Operator', CURRENT_DATE + TIME '09:32'),
    ('EMG-003', 'Alert Raised',        'Drill scheduled 14:00 — staff briefed', 'Security Manager', CURRENT_DATE - INTERVAL '1 day' + TIME '17:00'),
    ('EMG-004', 'Alert Raised',        'Gas odor reported by maintenance tech', 'Maintenance', CURRENT_DATE - INTERVAL '1 day' + TIME '16:20'),
    ('EMG-004', 'Evacuation Ordered',  'Basement level cleared', 'Carlos M.', CURRENT_DATE - INTERVAL '1 day' + TIME '16:30'),
    ('EMG-004', 'Evacuation Complete', 'Sweep complete — all personnel accounted for', 'Carlos M.', CURRENT_DATE - INTERVAL '1 day' + TIME '16:50'),
    ('EMG-004', 'All Clear',           'Gas isolated, ventilation verified, area reopened', 'Engineering Lead', CURRENT_DATE - INTERVAL '1 day' + TIME '18:00'),
    ('EMG-004', 'Resolved',            'Incident closed — report filed', 'Security Manager', CURRENT_DATE - INTERVAL '1 day' + TIME '18:05'),
    ('EMG-005', 'Alert Raised',        'Partial power loss detected — generators engaged', 'Building Management System', CURRENT_DATE + TIME '11:10'),
    ('EMG-005', 'Team Dispatched',     'Engineering investigating main feed; security on elevator check', 'Duty Officer', CURRENT_DATE + TIME '11:14')
) AS v(emergency_id, action, detail, actor, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sec_emergency_responses r
  WHERE r.emergency_id = v.emergency_id AND r.action = v.action AND r.created_at = v.created_at
);
