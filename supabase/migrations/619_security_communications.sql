-- ============================================================================
-- 619_security_communications.sql — Communication Center
-- Backs /erp/security/communication (CommunicationCenter.tsx).
--
--   sec_messages      — dispatch/internal/broadcast message register:
--                       msg_type (Dispatch/Internal/Broadcast/Emergency),
--                       priority (Emergency/Urgent/Routine), channel
--                       (Radio/App/Email/PA System), audience, sender,
--                       status (Sent/Acknowledged/Expired/Recalled),
--                       sent_at/expires_at.
--   sec_message_acks  — real per-person acknowledgement log (CASCADE on
--                       message delete). POST /:id/ack records an ack;
--                       when acks arrive the message status derives to
--                       Acknowledged server-side.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sec_messages (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  msg_type    TEXT NOT NULL DEFAULT 'Internal' CHECK (msg_type IN (
                'Dispatch', 'Internal', 'Broadcast', 'Emergency'
              )),
  priority    TEXT NOT NULL DEFAULT 'Routine' CHECK (priority IN (
                'Emergency', 'Urgent', 'Routine'
              )),
  channel     TEXT NOT NULL DEFAULT 'App' CHECK (channel IN (
                'Radio', 'App', 'Email', 'PA System'
              )),
  audience    TEXT NOT NULL DEFAULT 'All Security' CHECK (audience IN (
                'All Security', 'Shift Supervisors', 'Patrol Officers',
                'Control Room', 'Management', 'Custom'
              )),
  recipient   TEXT,             -- free-text when audience = Custom / dispatch target
  subject     TEXT NOT NULL,
  body        TEXT,
  sender      TEXT,
  status      TEXT NOT NULL DEFAULT 'Sent' CHECK (status IN (
                'Sent', 'Acknowledged', 'Expired', 'Recalled'
              )),
  sent_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP WITH TIME ZONE,
  created_by  TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_messages_prop    ON public.sec_messages(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_messages_status  ON public.sec_messages(status);
CREATE INDEX IF NOT EXISTS idx_sec_messages_type    ON public.sec_messages(msg_type);

CREATE OR REPLACE FUNCTION public.update_sec_messages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_messages_updated_at ON public.sec_messages;
CREATE TRIGGER trigger_sec_messages_updated_at
  BEFORE UPDATE ON public.sec_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_messages_timestamp();

ALTER TABLE public.sec_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_messages TO authenticated;

CREATE TABLE IF NOT EXISTS public.sec_message_acks (
  id         BIGSERIAL PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES public.sec_messages(id) ON DELETE CASCADE,
  acked_by   TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_message_acks_msg ON public.sec_message_acks(message_id);

ALTER TABLE public.sec_message_acks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_message_acks TO authenticated;

-- ── Seed: message register ───────────────────────────────────────────────
INSERT INTO public.sec_messages
  (id, property_id, msg_type, priority, channel, audience, recipient,
   subject, body, sender, status, sent_at, expires_at)
VALUES
  ('MSG-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Dispatch', 'Urgent', 'Radio',
   'Custom', 'Patrol Unit 2',
   'Assist at Pool Gate B',
   'Crowd forming at Pool Gate B — patrol unit 2 divert and assist gate staff. Report status when on scene.',
   'Control Room', 'Acknowledged', NOW() - INTERVAL '2 hours', NULL),
  ('MSG-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Broadcast', 'Urgent', 'App',
   'All Security', NULL,
   'Suspicious person — Level 2 parking',
   'Male, dark hoodie, checking vehicle door handles on P2 near stairwell. All units maintain visual contact; do not approach alone.',
   'Security Manager', 'Acknowledged', NOW() - INTERVAL '5 hours', NOW() + INTERVAL '19 hours'),
  ('MSG-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Emergency', 'Emergency', 'PA System',
   'All Security', NULL,
   'Code Silver drill — 14:00',
   'Reminder: scheduled lockdown drill at 14:00 today. Acknowledge this message and review muster-point assignments.',
   'Security Manager', 'Sent', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '6 hours'),
  ('MSG-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Internal', 'Routine', 'App',
   'Shift Supervisors', NULL,
   'Evening shift handover notes',
   'Overnight: elevator 3 intermittently offline (vendor on-site 22:00), VIP arrival 21:30 needs lobby escort, FAL-003 cash settlement flagged for review.',
   'Day Shift Supervisor', 'Acknowledged', NOW() - INTERVAL '1 day', NULL),
  ('MSG-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Dispatch', 'Routine', 'Radio',
   'Custom', 'Roving Patrol',
   'Service elevator escort — vendor',
   'AV vendor loading equipment at dock — escort to Ballroom via service elevator.',
   'Control Room', 'Acknowledged', NOW() - INTERVAL '1 day', NULL),
  ('MSG-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Broadcast', 'Routine', 'Email',
   'Management', NULL,
   'Weekly security digest',
   'Weekly summary attached: 3 incidents, 1 fraud case opened, patrol compliance 96%, no key discrepancies.',
   'Security Manager', 'Sent', NOW() - INTERVAL '2 days', NULL),
  ('MSG-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Emergency', 'Emergency', 'Radio',
   'All Security', NULL,
   'Gas smell — kitchen corridor',
   'Gas odor reported kitchen corridor. Ventilate area, keep guests clear, engineering en route. Stand by for evacuation order.',
   'Control Room', 'Recalled', NOW() - INTERVAL '3 days', NULL),
  ('MSG-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Internal', 'Routine', 'App',
   'Patrol Officers', NULL,
   'Checkpoint PAT-005 offline',
   'QR checkpoint at back-of-house corridor unreadable — use manual log until replaced.',
   'Shift Supervisor', 'Sent', NOW() - INTERVAL '30 minutes', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Seed: acknowledgements ───────────────────────────────────────────────
INSERT INTO public.sec_message_acks (message_id, acked_by, note, created_at)
VALUES
  ('MSG-001', 'Officer D. Haile', 'En route, ETA 3 min', NOW() - INTERVAL '2 hours' + INTERVAL '2 minutes'),
  ('MSG-001', 'Control Room', 'Unit confirmed on scene', NOW() - INTERVAL '2 hours' + INTERVAL '8 minutes'),
  ('MSG-002', 'Officer T. Bekele', 'Visual on subject, P2 south', NOW() - INTERVAL '5 hours' + INTERVAL '12 minutes'),
  ('MSG-002', 'Officer S. Alemu', NULL, NOW() - INTERVAL '5 hours' + INTERVAL '15 minutes'),
  ('MSG-002', 'Officer M. Girma', NULL, NOW() - INTERVAL '5 hours' + INTERVAL '22 minutes'),
  ('MSG-002', 'CCTV Operator', 'Tracking on CAM-014', NOW() - INTERVAL '5 hours' + INTERVAL '30 minutes'),
  ('MSG-004', 'Night Shift Supervisor', NULL, NOW() - INTERVAL '1 day' + INTERVAL '10 minutes'),
  ('MSG-005', 'Officer R. Tesfaye', 'Escort complete', NOW() - INTERVAL '1 day' + INTERVAL '40 minutes');
