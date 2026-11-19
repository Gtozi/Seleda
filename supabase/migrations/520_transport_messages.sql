-- 520_transport_messages.sql
-- Communication Center messages — driver/dispatch/guest/emergency comms.

CREATE TABLE IF NOT EXISTS transport_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  message_number   TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'Driver Message'
                     CHECK (type IN ('Driver Message', 'Guest Notification', 'Dispatch Notification', 'Emergency Alert')),
  from_party       TEXT NOT NULL,
  to_party         TEXT NOT NULL,
  subject          TEXT,
  content          TEXT,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT NOT NULL DEFAULT 'Sent'
                     CHECK (status IN ('Pending', 'Sent', 'Delivered', 'Read', 'Failed')),
  priority         TEXT NOT NULL DEFAULT 'Normal'
                     CHECK (priority IN ('Critical', 'High', 'Normal', 'Low')),
  related_trip_id  UUID REFERENCES transport_requests(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, message_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_messages_property ON transport_messages(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_messages_type     ON transport_messages(property_id, type);
CREATE INDEX IF NOT EXISTS idx_transport_messages_sent     ON transport_messages(property_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_messages_trip     ON transport_messages(related_trip_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_messages TO authenticated;

ALTER TABLE transport_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_messages_read ON transport_messages;
CREATE POLICY transport_messages_read ON transport_messages
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_messages_write ON transport_messages;
CREATE POLICY transport_messages_write ON transport_messages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's messages for GH-MAIN ───────────────────────────────────
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  tr_001 UUID; tr_003 UUID; tr_002 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_messages WHERE property_id = v_main) THEN
    SELECT id INTO tr_001 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-001';
    SELECT id INTO tr_003 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-003';
    SELECT id INTO tr_002 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-002';

    INSERT INTO transport_messages
      (property_id, message_number, type, from_party, to_party, subject, content, sent_at, status, priority, related_trip_id)
    VALUES
      (v_main, 'MSG-001', 'Driver Message', 'Aisha P. (Driver)', 'Dispatch',
       'Traffic delay on route to JFK', 'Experiencing heavy traffic on Van Wyck Expressway. ETA extended by 15 minutes.',
       NOW() - interval '5 minutes', 'Read', 'Normal', tr_001),
      (v_main, 'MSG-002', 'Guest Notification', 'System', 'John Smith (Room 302)',
       'Your driver has arrived', 'Your driver Aisha P. is waiting at JFK Airport Terminal 4, Arrivals area.',
       NOW() - interval '10 minutes', 'Delivered', 'Normal', tr_001),
      (v_main, 'MSG-003', 'Dispatch Notification', 'Dispatch', 'Carlos M. (Driver)',
       'New trip assignment', 'You have been assigned to trip TR-003. Please proceed to Hotel Main Entrance for pickup.',
       NOW() - interval '15 minutes', 'Read', 'High', tr_003),
      (v_main, 'MSG-004', 'Emergency Alert', 'System', 'All Drivers',
       'Vehicle breakdown - VH-005', 'Vehicle VH-005 has broken down on Highway 27. All drivers avoid this area.',
       NOW() - interval '45 minutes', 'Read', 'Critical', NULL),
      (v_main, 'MSG-005', 'Driver Message', 'Maria S. (Driver)', 'Dispatch',
       'Completed trip TR-002', 'Trip completed successfully. Guest dropped off at Times Square. Vehicle returning to hotel.',
       NOW() - interval '1 hour', 'Read', 'Normal', tr_002);
  END IF;
END $$;
