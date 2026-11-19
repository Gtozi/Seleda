-- Migration: Security Incident Management — extend sec_incidents
-- Backs the /erp/security/incidents tab (IncidentManagement.tsx).
-- Unifies SOC dispatch queue and Incident Management on one table:
-- adds `category` + `reported_by` columns and widens the status CHECK
-- to the full case lifecycle (union of SOC + IM status vocabularies).
--
-- Canonical lifecycle: Draft → Reported → Classified → Assigned →
--   In Progress → Investigation → Corrective Action → Closed
-- SOC short-hand statuses kept for backward compat: Active, Pending, Resolved.

ALTER TABLE public.sec_incidents
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS reported_by TEXT;

ALTER TABLE public.sec_incidents DROP CONSTRAINT IF EXISTS sec_incidents_status_check;
ALTER TABLE public.sec_incidents ADD CONSTRAINT sec_incidents_status_check
  CHECK (status IN (
    'Draft', 'Reported', 'Classified', 'Assigned', 'In Progress',
    'Investigation', 'Corrective Action', 'Closed',
    'Active', 'Pending', 'Resolved'
  ));

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Mirrors the former hardcoded array in IncidentManagement.tsx
-- (IDs continue from the SOC seed INC-001..005).
INSERT INTO public.sec_incidents
  (id, property_id, category, incident_type, description, location, reported_by, priority, status, reported_at, assigned_to)
VALUES
  ('INC-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Theft', 'Theft', 'Guest reported stolen laptop from room 312', 'Room 312', 'Guest - John Smith', 'High', 'In Progress', '2024-01-15 10:30', 'John D.'),
  ('INC-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Medical Emergency', 'Medical Emergency', 'Guest experienced chest pain near pool area', 'Pool Area', 'Staff - Elena R.', 'Critical', 'Closed', '2024-01-15 09:15', 'Elena R.'),
  ('INC-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Property Damage', 'Property Damage', 'Broken window in lobby due to weather', 'Lobby', 'Staff - Carlos M.', 'Medium', 'Corrective Action', '2024-01-15 08:00', 'Carlos M.'),
  ('INC-009', '18762279-a389-41c9-9169-7ebc682e9703', 'Security Breach', 'Security Breach', 'Unauthorized access attempt at rear entrance', 'Rear Entrance', 'System - CCTV', 'High', 'Investigation', '2024-01-14 23:45', 'Sarah L.'),
  ('INC-010', '18762279-a389-41c9-9169-7ebc682e9703', 'Lost Property', 'Lost Property', 'Guest left wallet in restaurant', 'Restaurant', 'Guest - Mary Johnson', 'Low', 'Closed', '2024-01-14 18:30', NULL)
ON CONFLICT (id) DO NOTHING;
