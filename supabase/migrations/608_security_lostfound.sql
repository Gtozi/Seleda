-- Migration: Security Lost & Found Oversight
-- Backs the /erp/security/lost-found tab (LostFoundOversight.tsx).
-- Same pattern as migrations 602/605: a case register + child custody log.

-- ── 1. Lost & found cases ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_lostfound_cases (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  item_name       TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL DEFAULT 'Other' CHECK (category IN (
                    'Electronics', 'Jewelry & Watches', 'Documents',
                    'Clothing', 'Bag & Luggage', 'Keys', 'Personal Items', 'Other'
                  )),
  status          TEXT NOT NULL DEFAULT 'Reported' CHECK (status IN (
                    'Reported', 'Found', 'In Storage', 'Claim Pending',
                    'Returned', 'Disposed'
                  )),
  location_lost   TEXT,
  location_found  TEXT,
  storage_location TEXT,
  reported_by     TEXT,
  reporter_contact TEXT,
  finder_name     TEXT,
  claimed_by      TEXT,
  claim_notes     TEXT,
  estimated_value NUMERIC(10,2),
  reported_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  found_at        TIMESTAMP WITH TIME ZONE,
  claimed_at      TIMESTAMP WITH TIME ZONE,
  returned_at     TIMESTAMP WITH TIME ZONE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_lostfound_prop ON public.sec_lostfound_cases(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_lostfound_status ON public.sec_lostfound_cases(status);
CREATE INDEX IF NOT EXISTS idx_sec_lostfound_category ON public.sec_lostfound_cases(category);

CREATE OR REPLACE FUNCTION public.update_sec_lostfound_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_lostfound_updated_at ON public.sec_lostfound_cases;
CREATE TRIGGER trigger_sec_lostfound_updated_at
  BEFORE UPDATE ON public.sec_lostfound_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_lostfound_timestamp();

ALTER TABLE public.sec_lostfound_cases ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_lostfound_cases TO authenticated;

-- ── 2. Chain of custody log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_lostfound_custody (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     TEXT NOT NULL REFERENCES public.sec_lostfound_cases(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN (
                'Registered', 'Item Found', 'Placed in Storage',
                'Claim Submitted', 'Claim Verified', 'Released to Owner',
                'Disposed', 'Transferred', 'Edited', 'Note'
              )),
  from_person TEXT,
  to_person   TEXT,
  location    TEXT,
  note        TEXT,
  actor       TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_lostfound_custody_case ON public.sec_lostfound_custody(case_id);

ALTER TABLE public.sec_lostfound_custody ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_lostfound_custody TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_lostfound_cases
  (id, property_id, item_name, description, category, status,
   location_lost, location_found, storage_location,
   reported_by, reporter_contact, finder_name, claimed_by,
   estimated_value, reported_at, found_at, claimed_at, returned_at)
VALUES
  ('LF-001', '18762279-a389-41c9-9169-7ebc682e9703', 'iPhone 15 Pro',
   'Black titanium iPhone with hotel loyalty app on lock screen',
   'Electronics', 'In Storage', NULL, 'Pool Area', 'Security Office - Safe A',
   'Guest Room 412', 'guest412@email.com', 'Maria S. (Housekeeping)', NULL,
   999.00, CURRENT_DATE - INTERVAL '1 day' + TIME '11:20', CURRENT_DATE - INTERVAL '1 day' + TIME '13:45', NULL, NULL),
  ('LF-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Gold Wedding Band',
   'Engraved gold ring, initials "J+K 2019" inside band',
   'Jewelry & Watches', 'Claim Pending', 'Fitness Center', 'Fitness Center - Locker 8', 'Security Office - Safe A',
   'John Kramer', 'Room 208', 'David L. (Attendant)', 'John Kramer',
   850.00, CURRENT_DATE - INTERVAL '2 days' + TIME '09:10', CURRENT_DATE - INTERVAL '2 days' + TIME '10:30',
   CURRENT_DATE - INTERVAL '1 day' + TIME '15:00', NULL),
  ('LF-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Leather Wallet',
   'Brown leather wallet with cards, no cash',
   'Personal Items', 'Returned', 'Restaurant', 'Restaurant - Booth 12', 'Front Desk Storage',
   'Sarah Mitchell', 'sarah.m@email.com', 'Server Team', 'Sarah Mitchell',
   120.00, CURRENT_DATE - INTERVAL '3 days' + TIME '20:15', CURRENT_DATE - INTERVAL '3 days' + TIME '21:00',
   CURRENT_DATE - INTERVAL '3 days' + TIME '22:30', CURRENT_DATE - INTERVAL '3 days' + TIME '22:45'),
  ('LF-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Child''s Stuffed Rabbit',
   'Grey plush rabbit toy, well-loved, name tag "Bunny"',
   'Personal Items', 'Found', NULL, 'Lobby - Sofa Area', 'Front Desk Storage',
   NULL, NULL, 'Concierge Desk', NULL,
   15.00, CURRENT_DATE + TIME '08:30', CURRENT_DATE + TIME '08:30', NULL, NULL),
  ('LF-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Car Keys - BMW',
   'BMW key fob with blue lanyard and parking tag',
   'Keys', 'Reported', 'Parking - Level B1', NULL, NULL,
   'Robert Chen', 'Room 315 / ext. 4315', NULL, NULL,
   300.00, CURRENT_DATE + TIME '09:45', NULL, NULL, NULL),
  ('LF-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Umbrella - Navy',
   'Navy blue folding umbrella, wooden handle',
   'Other', 'Disposed', NULL, 'Conference Room B', 'Basement Storage Bin',
   NULL, NULL, 'Events Team', NULL,
   25.00, CURRENT_DATE - INTERVAL '45 days' + TIME '14:00', CURRENT_DATE - INTERVAL '45 days' + TIME '14:00', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Custody entries (guarded for idempotent re-runs)
INSERT INTO public.sec_lostfound_custody (case_id, action, from_person, to_person, location, note, actor, created_at)
SELECT * FROM (
  VALUES
    ('LF-001', 'Registered',     'Maria S. (Housekeeping)', 'Security Desk', 'Pool Area', 'Item found poolside, powered off', 'SOC Operator', CURRENT_DATE - INTERVAL '1 day' + TIME '13:45'),
    ('LF-001', 'Item Found',     'Maria S. (Housekeeping)', 'Security Desk', 'Pool Area', NULL, 'SOC Operator', CURRENT_DATE - INTERVAL '1 day' + TIME '13:45'),
    ('LF-001', 'Placed in Storage', 'Security Desk', 'Safe A', 'Security Office', 'Locked in safe, awaiting claim', 'Duty Officer', CURRENT_DATE - INTERVAL '1 day' + TIME '14:10'),
    ('LF-002', 'Item Found',     'David L. (Attendant)', 'Security Desk', 'Fitness Center - Locker 8', 'Found during locker check', 'SOC Operator', CURRENT_DATE - INTERVAL '2 days' + TIME '10:30'),
    ('LF-002', 'Placed in Storage', 'Security Desk', 'Safe A', 'Security Office', 'High-value item — safe storage', 'Duty Officer', CURRENT_DATE - INTERVAL '2 days' + TIME '10:45'),
    ('LF-002', 'Claim Submitted','John Kramer', 'Security Desk', 'Front Desk', 'Guest described engraving correctly', 'Front Desk Agent', CURRENT_DATE - INTERVAL '1 day' + TIME '15:00'),
    ('LF-003', 'Item Found',     'Server Team', 'Front Desk', 'Restaurant - Booth 12', NULL, 'Restaurant Supervisor', CURRENT_DATE - INTERVAL '3 days' + TIME '21:00'),
    ('LF-003', 'Claim Submitted','Sarah Mitchell', 'Front Desk', 'Front Desk', 'Verified wallet contents by description', 'Front Desk Agent', CURRENT_DATE - INTERVAL '3 days' + TIME '22:30'),
    ('LF-003', 'Released to Owner','Front Desk', 'Sarah Mitchell', 'Front Desk', 'ID verified — passport matched', 'Front Desk Agent', CURRENT_DATE - INTERVAL '3 days' + TIME '22:45'),
    ('LF-004', 'Registered',     'Concierge Desk', 'Front Desk Storage', 'Lobby - Sofa Area', 'Likely child''s toy — hold 30 days', 'Concierge', CURRENT_DATE + TIME '08:30'),
    ('LF-005', 'Registered',     'Robert Chen', 'Security Desk', 'Front Desk', 'Lost report — last seen parking level B1. Patrols alerted.', 'Front Desk Agent', CURRENT_DATE + TIME '09:45'),
    ('LF-006', 'Registered',     'Events Team', 'Basement Storage Bin', 'Conference Room B', NULL, 'Security Desk', CURRENT_DATE - INTERVAL '45 days' + TIME '14:00'),
    ('LF-006', 'Disposed',       'Security Desk', 'Charity Donation', 'Basement', 'Retention period expired — donated per policy', 'Security Manager', CURRENT_DATE - INTERVAL '2 days' + TIME '16:00')
) AS v(case_id, action, from_person, to_person, location, note, actor, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sec_lostfound_custody c
  WHERE c.case_id = v.case_id AND c.action = v.action AND c.created_at = v.created_at
);
