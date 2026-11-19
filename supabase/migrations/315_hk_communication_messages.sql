-- Migration: Housekeeping Communication Center Messages
-- Backs the Communication Center module (docs/Housekeeping Portal new.md §22).
-- Channels: Internal Chat, Task Notifications, Escalations, Shift
-- Announcements, Guest Service Notifications.
--
-- Previously the module rendered hardcoded `seed` data
-- (CommunicationCenterModule.tsx). This migration persists that contract to
-- the DB so the module can fetch/persist via /api/hk-portal/communication.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housekeeping_communication_messages (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  channel       TEXT NOT NULL CHECK (channel IN (
                  'Internal Chat', 'Task Notifications', 'Escalations',
                  'Shift Announcements', 'Guest Service Notifications'
                )),
  from_name     TEXT NOT NULL,
  body          TEXT NOT NULL,
  timestamp     TEXT NOT NULL,
  unread        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_comm_messages_property
  ON housekeeping_communication_messages(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_comm_messages_channel
  ON housekeeping_communication_messages(channel);
CREATE INDEX IF NOT EXISTS idx_hk_comm_messages_unread
  ON housekeeping_communication_messages(unread);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_comm_messages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_comm_messages_updated_at ON housekeeping_communication_messages;
CREATE TRIGGER trigger_hk_comm_messages_updated_at
  BEFORE UPDATE ON housekeeping_communication_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_comm_messages_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON housekeeping_communication_messages TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 7 messages previously hardcoded as `seed` in
-- CommunicationCenterModule.tsx. Uses the single demo property.
INSERT INTO housekeeping_communication_messages
  (id, property_id, channel, from_name, body, timestamp, unread)
VALUES
  ('CM-01', '18762279-a389-41c9-9169-7ebc682e9703', 'Internal Chat',              'Maria S.',         'Room 101 cleaning complete, ready for inspection.',                       '09:15 AM', FALSE),
  ('CM-02', '18762279-a389-41c9-9169-7ebc682e9703', 'Task Notifications',         'System',           'New VIP preparation task assigned for Room 502.',                          '09:20 AM', TRUE),
  ('CM-03', '18762279-a389-41c9-9169-7ebc682e9703', 'Escalations',                'Supervisor A. Doe','Room 102 failed inspection — rework required immediately.',               '10:15 AM', TRUE),
  ('CM-04', '18762279-a389-41c9-9169-7ebc682e9703', 'Shift Announcements',        'Manager',          'Morning shift: all hands on deck for VIP arrival at 2 PM.',                '07:00 AM', FALSE),
  ('CM-05', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Service Notifications','Concierge',        'Guest in Room 305 requests extra pillows — dispatched to James L.',        '09:25 AM', TRUE),
  ('CM-06', '18762279-a389-41c9-9169-7ebc682e9703', 'Internal Chat',              'Priya K.',         'Need linen restock on Floor 3 — bath towels low.',                         '09:40 AM', FALSE),
  ('CM-07', '18762279-a389-41c9-9169-7ebc682e9703', 'Task Notifications',         'System',           'Deep cleaning for Room 401 is overdue by 1 day.',                          '08:00 AM', TRUE)
ON CONFLICT (id) DO NOTHING;
