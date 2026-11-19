-- ============================================================
-- Engineering Portal — Communication Center (Migration 335)
-- ============================================================
-- Backs the /erp/maintenance/communication tab
-- (CommunicationCenter.tsx). Previously the module rendered
-- hardcoded mock data in useState for both messages and
-- notifications. This migration persists that contract to the DB
-- so the module can fetch/persist via /api/eng-portal/communication.
--
-- Two tables:
--   1. eng_communication_messages — announcements, alerts, requests,
--      updates, reminders sent within the Engineering department.
--      Flow: Sent → Read → Archived.
--   2. eng_communication_notifications — system/work-order/alert/request
--      notifications surfaced in the sidebar. read flag toggles.
-- ============================================================

-- ── 1. Messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_communication_messages (
  id              TEXT PRIMARY KEY,
  property_id     UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  msg_number      TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN (
                    'Announcement', 'Alert', 'Request', 'Update', 'Reminder'
                  )),
  category        TEXT NOT NULL CHECK (category IN (
                    'General', 'Safety', 'Maintenance', 'Emergency', 'Compliance'
                  )),
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  sender          TEXT NOT NULL,
  sender_role     TEXT,
  recipients      TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'Sent' CHECK (status IN (
                    'Sent', 'Read', 'Archived'
                  )),
  priority        TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                    'Critical', 'High', 'Normal', 'Low'
                  )),
  attachments     INTEGER NOT NULL DEFAULT 0,
  read_at         TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_comm_messages_property
  ON public.eng_communication_messages(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_comm_messages_status
  ON public.eng_communication_messages(status);
CREATE INDEX IF NOT EXISTS idx_eng_comm_messages_type
  ON public.eng_communication_messages(type);
CREATE INDEX IF NOT EXISTS idx_eng_comm_messages_priority
  ON public.eng_communication_messages(priority);
CREATE INDEX IF NOT EXISTS idx_eng_comm_messages_created_at
  ON public.eng_communication_messages(created_at DESC);

-- ── 2. Notifications ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_communication_notifications (
  id              TEXT PRIMARY KEY,
  property_id     UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN (
                    'System', 'Work Order', 'Alert', 'Request'
                  )),
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  read            BOOLEAN NOT NULL DEFAULT FALSE,
  action_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_comm_notifs_property
  ON public.eng_communication_notifications(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_comm_notifs_read
  ON public.eng_communication_notifications(read);
CREATE INDEX IF NOT EXISTS idx_eng_comm_notifs_created_at
  ON public.eng_communication_notifications(created_at DESC);

-- ── updated_at triggers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_eng_communication_messages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_comm_messages_updated_at ON public.eng_communication_messages;
CREATE TRIGGER trg_eng_comm_messages_updated_at
  BEFORE UPDATE ON public.eng_communication_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_communication_messages_timestamp();

CREATE OR REPLACE FUNCTION public.update_eng_communication_notifications_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_comm_notifs_updated_at ON public.eng_communication_notifications;
CREATE TRIGGER trg_eng_comm_notifs_updated_at
  BEFORE UPDATE ON public.eng_communication_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_communication_notifications_timestamp();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.eng_communication_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_communication_messages"
  ON public.eng_communication_messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_communication_messages TO authenticated;

ALTER TABLE public.eng_communication_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_communication_notifications"
  ON public.eng_communication_notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_communication_notifications TO authenticated;

-- ── Seed mock messages ───────────────────────────────────────────────────
-- The 5 messages previously hardcoded as useState initial state in
-- CommunicationCenter.tsx. Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.eng_communication_messages
  (id, property_id, msg_number, type, category, title, content, sender,
   sender_role, recipients, status, priority, attachments)
VALUES
  ('MSG-001', '18762279-a389-41c9-9169-7ebc682e9703', 'MSG-2026-001',
   'Alert', 'Emergency', 'Generator Maintenance Required',
   'Backup generator requires immediate maintenance. Fuel levels below 20% and cooling system showing elevated temperatures.',
   'John Electrician', 'Senior Electrician',
   ARRAY['Engineering Team', 'Management'], 'Sent', 'Critical', 0),
  ('MSG-002', '18762279-a389-41c9-9169-7ebc682e9703', 'MSG-2026-002',
   'Announcement', 'General', 'Quarterly Maintenance Schedule Published',
   'The Q3 2026 preventive maintenance schedule has been published. Please review your assigned tasks and confirm availability.',
   'Engineering Manager', 'Department Head',
   ARRAY['All Engineering Staff'], 'Read', 'Normal', 0),
  ('MSG-003', '18762279-a389-41c9-9169-7ebc682e9703', 'MSG-2026-003',
   'Request', 'Maintenance', 'Spare Parts Approval Request',
   'Requesting approval for purchase of 5 HEPA filters for HVAC system. Estimated cost: $225.',
   'Maria HVAC', 'HVAC Technician',
   ARRAY['Engineering Manager', 'Procurement'], 'Sent', 'High', 1),
  ('MSG-004', '18762279-a389-41c9-9169-7ebc682e9703', 'MSG-2026-004',
   'Update', 'Safety', 'Fire Drill Completed Successfully',
   'Monthly fire drill completed on July 27. All systems operational. Minor issues identified in Zone B smoke detectors.',
   'Safety Officer', 'Safety Compliance',
   ARRAY['Engineering Team', 'Security', 'Management'], 'Read', 'Normal', 0),
  ('MSG-005', '18762279-a389-41c9-9169-7ebc682e9703', 'MSG-2026-005',
   'Reminder', 'Compliance', 'Elevator Inspection Due Next Week',
   'Annual elevator inspection scheduled for August 5. Please ensure all documentation is prepared.',
   'Engineering Manager', 'Department Head',
   ARRAY['Elevator Maintenance Team'], 'Sent', 'High', 0)
ON CONFLICT (id) DO NOTHING;

-- ── Seed mock notifications ──────────────────────────────────────────────
-- The 4 notifications previously hardcoded as useState initial state.
INSERT INTO public.eng_communication_notifications
  (id, property_id, type, title, message, read)
VALUES
  ('NOT-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Alert',
   'High Temperature Alert',
   'Boiler temperature exceeding normal range.', FALSE),
  ('NOT-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Work Order',
   'WO-2026-002 Assigned',
   'New work order assigned: Power outage in lobby.', FALSE),
  ('NOT-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Request',
   'Spare Parts Request',
   'New spare parts request pending approval.', TRUE),
  ('NOT-004', '18762279-a389-41c9-9169-7ebc682e9703', 'System',
   'PM Schedule Generated',
   'Preventive maintenance schedule for August generated.', TRUE)
ON CONFLICT (id) DO NOTHING;
