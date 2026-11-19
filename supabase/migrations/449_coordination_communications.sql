-- 449_coordination_communications.sql
--
-- Department coordination requests and event communications.
-- Replaces the hardcoded mock data in the Coordination & Communication tab.

-- ── 1. Department coordination requests ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_dept_coordination (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text NOT NULL,
  department text NOT NULL,        -- Front Office | Housekeeping | Kitchen | Maintenance | Security | IT | AV | Bar
  contact_person text,
  requirements text,
  deadline date,
  status text NOT NULL DEFAULT 'Pending',  -- Pending | InProgress | Completed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_dept_coord_event ON public.banquet_dept_coordination (event_id);
CREATE INDEX IF NOT EXISTS idx_banquet_dept_coord_dept ON public.banquet_dept_coordination (department);

-- ── 2. Event communications ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_communications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text NOT NULL,
  recipient text NOT NULL,
  recipient_type text NOT NULL DEFAULT 'Guest',  -- Guest | Vendor | Staff | All
  subject text,
  message text NOT NULL,
  communication_type text NOT NULL DEFAULT 'Email',  -- Email | SMS | WhatsApp | In-App
  priority text NOT NULL DEFAULT 'Normal',  -- Low | Normal | High | Urgent
  status text NOT NULL DEFAULT 'Sent',  -- Sent | Pending | Failed
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_comm_event ON public.banquet_communications (event_id);

-- ── 3. Seed mock data ────────────────────────────────────────────────
-- Use existing events that are in Planning/InProgress/Confirmed status.
INSERT INTO public.banquet_dept_coordination (property_id, event_id, department, contact_person, requirements, deadline, status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Kitchen', 'Chef Maria Girma', 'Prepare lunch buffet for 300 conference attendees. Vegetarian and vegan options required. Setup by 11:30.', '2026-09-14', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Housekeeping', 'Supervisor John Bekele', 'Clean and set up Crystal Ballroom A and Marble Conference A. Refresh break rooms every 2 hours.', '2026-09-14', 'InProgress'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Front Office', 'Manager Sarah Tadesse', 'Prepare 300 welcome kits and name badges. Coordinate VIP check-ins for keynote speakers.', '2026-09-14', 'Completed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'AV', 'Tech Lead Dawit Haile', 'Setup 2 projectors, LED screen, wireless microphones, and translation headsets for Crystal Ballroom A.', '2026-09-15', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Kitchen', 'Chef Yohannes Alemu', 'Wedding reception dinner for 250 guests. 5-course plated meal. Coordinate cake delivery and champagne toast.', '2026-09-18', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Housekeeping', 'Supervisor Meron Kebede', 'Setup Grand Ballroom for wedding reception. Prepare bridal suite and guest room blocks. Decorate ceremony area.', '2026-09-18', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Front Office', 'Manager Sarah Tadesse', 'Check in wedding party of 45 rooms. Early check-in for bridal party. Coordinate with room block reservations.', '2026-09-19', 'InProgress'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Kitchen', 'Chef Maria Girma', 'African Union Forum — coffee break service for 90 delegates. Continental breakfast and afternoon tea.', '2026-09-21', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'AV', 'Tech Lead Dawit Haile', 'Translation headsets for 90 delegates. 2 projectors for Terrace Lounge and Azure Room. Panel microphones.', '2026-09-22', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Security', 'Captain Tsegaye Lemma', 'Security screening for 90 AU delegates. Coordinate with protocol team. VIP parking arrangements.', '2026-09-21', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Kitchen', 'Chef Yohannes Alemu', 'Gala dinner for 180 guests. Plated 3-course meal. Wine pairing service.', '2026-09-25', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Maintenance', 'Engineer Solomon Bekele', 'Check HVAC in Grand Ballroom. Verify lighting dimmer controls. Test audio system.', '2026-09-24', 'Completed')
ON CONFLICT DO NOTHING;

INSERT INTO public.banquet_communications (property_id, event_id, recipient, recipient_type, subject, message, communication_type, priority, status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Dr. Abebe Kebede', 'Guest', 'Conference Confirmation', 'Dear Dr. Kebede, your keynote session at the TechCorp Annual Conference is confirmed for September 15, 2026 at 8:00 AM in Crystal Ballroom A. Please arrive 30 minutes early for AV setup.', 'Email', 'High', 'Sent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'All Conference Attendees', 'All', 'Event Reminder', 'Reminder: TechCorp Annual Conference starts tomorrow at 8:00 AM. Registration opens at 7:00 AM in the main lobby.', 'SMS', 'Normal', 'Sent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Bride & Groom Families', 'Guest', 'Wedding Day Schedule', 'Dear families, the wedding ceremony will begin at 4:00 PM on September 19, 2026 in the Garden Terrace. Reception follows in the Grand Ballroom at 6:30 PM. Please arrive by 3:30 PM.', 'Email', 'High', 'Sent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Floral Decor Vendor', 'Vendor', 'Delivery Confirmation', 'Please confirm delivery of floral arrangements by 2:00 PM on September 19. Contact the front desk upon arrival for loading dock access.', 'WhatsApp', 'Normal', 'Sent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'AU Protocol Team', 'Guest', 'Security & Protocol Briefing', 'Security screening will be conducted at the main entrance. Please bring identification badges. VIP parking is reserved in the East lot.', 'Email', 'Urgent', 'Sent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Translation Services', 'Vendor', 'Headset Delivery', 'Please deliver 90 translation headsets by September 21, 5:00 PM. Test all units before delivery.', 'Email', 'High', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Gala Sponsors', 'Guest', 'Sponsor Recognition', 'Thank you for sponsoring the Gala Dinner 2026. Your logo will be displayed on the main screen and printed materials. Please confirm your representative attendance.', 'Email', 'Normal', 'Sent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Kitchen Staff', 'Staff', 'Service Briefing', 'All kitchen staff: service briefing at 5:00 PM on September 25. Review plating sequence and wine pairing schedule for 180 guests.', 'In-App', 'High', 'Sent')
ON CONFLICT DO NOTHING;
