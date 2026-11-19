-- 453_banquet_report_catalog.sql
--
-- Banquet & Event report catalog — a registry of all report definitions,
-- mirroring the fb_reports pattern. Every report exists as a row even
-- if it has never been run (last_run = NULL, status = 'Scheduled').
-- Running a report updates last_run + status; the list always shows all.

CREATE TABLE IF NOT EXISTS public.banquet_event_report_catalog (
  id text PRIMARY KEY,
  property_id uuid,
  category text NOT NULL,            -- event_summary | revenue | occupancy | vendor | resource | guest_feedback
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  last_run timestamptz,
  status text NOT NULL DEFAULT 'Scheduled',  -- Ready | Scheduled | Generating | Failed
  format text NOT NULL DEFAULT 'PDF',         -- PDF | Excel | CSV
  frequency text NOT NULL DEFAULT 'Monthly', -- Daily | Weekly | Monthly | Quarterly | Annual
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_report_cat_category ON public.banquet_event_report_catalog (category);

-- ── Seed all report definitions ────────────────────────────────────
-- 6 categories × 4 frequencies = 24 report definitions.
INSERT INTO public.banquet_event_report_catalog (id, property_id, category, name, description, last_run, status, format, frequency) VALUES
  -- Event Summary
  ('BE-ES-D', '18762279-a389-41c9-9169-7ebc682e9703', 'event_summary', 'Daily Event Summary', 'Daily rollup of all events: status, attendance, type breakdown', '2026-09-30 18:00:00+03', 'Ready', 'PDF', 'Daily'),
  ('BE-ES-W', '18762279-a389-41c9-9169-7ebc682e9703', 'event_summary', 'Weekly Event Summary', 'Weekly rollup of events by type, status, and attendance', '2026-09-30 18:00:00+03', 'Ready', 'Excel', 'Weekly'),
  ('BE-ES-M', '18762279-a389-41c9-9169-7ebc682e9703', 'event_summary', 'Monthly Event Summary', 'Monthly summary of all banquet events with attendance and status', '2026-09-30 18:00:00+03', 'Ready', 'PDF', 'Monthly'),
  ('BE-ES-Q', '18762279-a389-41c9-9169-7ebc682e9703', 'event_summary', 'Quarterly Event Summary', 'Quarterly event performance with trend analysis', NULL, 'Scheduled', 'Excel', 'Quarterly'),
  -- Revenue
  ('BE-REV-D', '18762279-a389-41c9-9169-7ebc682e9703', 'revenue', 'Daily Revenue Report', 'Daily banquet revenue by charge category', '2026-09-30 18:05:00+03', 'Ready', 'PDF', 'Daily'),
  ('BE-REV-W', '18762279-a389-41c9-9169-7ebc682e9703', 'revenue', 'Weekly Revenue Report', 'Weekly revenue breakdown: venue, catering, beverage, equipment, decoration', '2026-09-30 18:05:00+03', 'Ready', 'Excel', 'Weekly'),
  ('BE-REV-M', '18762279-a389-41c9-9169-7ebc682e9703', 'revenue', 'Monthly Revenue Report', 'Monthly revenue with deposits collected and outstanding balances', '2026-09-30 18:05:00+03', 'Ready', 'PDF', 'Monthly'),
  ('BE-REV-Q', '18762279-a389-41c9-9169-7ebc682e9703', 'revenue', 'Quarterly Revenue Report', 'Quarterly P&L by event type and charge category', NULL, 'Scheduled', 'Excel', 'Quarterly'),
  -- Occupancy
  ('BE-OCC-W', '18762279-a389-41c9-9169-7ebc682e9703', 'occupancy', 'Weekly Occupancy Analysis', 'Weekly venue utilization: expected vs actual attendance', '2026-09-30 18:10:00+03', 'Ready', 'Excel', 'Weekly'),
  ('BE-OCC-M', '18762279-a389-41c9-9169-7ebc682e9703', 'occupancy', 'Monthly Occupancy Analysis', 'Monthly venue utilization rate, peak days, average attendance', '2026-09-30 18:10:00+03', 'Ready', 'PDF', 'Monthly'),
  ('BE-OCC-Q', '18762279-a389-41c9-9169-7ebc682e9703', 'occupancy', 'Quarterly Occupancy Analysis', 'Quarterly venue utilization trends and capacity planning', NULL, 'Scheduled', 'Excel', 'Quarterly'),
  ('BE-OCC-A', '18762279-a389-41c9-9169-7ebc682e9703', 'occupancy', 'Annual Occupancy Analysis', 'Annual venue utilization summary with year-over-year comparison', NULL, 'Scheduled', 'PDF', 'Annual'),
  -- Vendor Performance
  ('BE-VEN-M', '18762279-a389-41c9-9169-7ebc682e9703', 'vendor', 'Monthly Vendor Performance', 'Monthly vendor scores: on-time delivery, quality, issues', '2026-09-30 18:15:00+03', 'Ready', 'PDF', 'Monthly'),
  ('BE-VEN-Q', '18762279-a389-41c9-9169-7ebc682e9703', 'vendor', 'Quarterly Vendor Performance', 'Quarterly vendor performance ranking and recommendations', '2026-09-30 18:15:00+03', 'Ready', 'Excel', 'Quarterly'),
  ('BE-VEN-A', '18762279-a389-41c9-9169-7ebc682e9703', 'vendor', 'Annual Vendor Performance', 'Annual vendor performance review and contract renewal recommendations', NULL, 'Scheduled', 'PDF', 'Annual'),
  -- Resource Utilization
  ('BE-RES-W', '18762279-a389-41c9-9169-7ebc682e9703', 'resource', 'Weekly Resource Utilization', 'Weekly venue hours, equipment usage, staff allocation', '2026-09-30 18:20:00+03', 'Ready', 'Excel', 'Weekly'),
  ('BE-RES-M', '18762279-a389-41c9-9169-7ebc682e9703', 'resource', 'Monthly Resource Utilization', 'Monthly resource utilization: venues, equipment, labor hours', '2026-09-30 18:20:00+03', 'Ready', 'PDF', 'Monthly'),
  ('BE-RES-Q', '18762279-a389-41c9-9169-7ebc682e9703', 'resource', 'Quarterly Resource Utilization', 'Quarterly resource utilization with efficiency recommendations', NULL, 'Scheduled', 'Excel', 'Quarterly'),
  -- Guest Feedback
  ('BE-GF-W', '18762279-a389-41c9-9169-7ebc682e9703', 'guest_feedback', 'Weekly Guest Feedback', 'Weekly satisfaction scores, complaints, and recommendations', '2026-09-30 18:25:00+03', 'Ready', 'PDF', 'Weekly'),
  ('BE-GF-M', '18762279-a389-41c9-9169-7ebc682e9703', 'guest_feedback', 'Monthly Guest Feedback', 'Monthly guest satisfaction analysis with complaint tracking', '2026-09-30 18:25:00+03', 'Ready', 'Excel', 'Monthly'),
  ('BE-GF-Q', '18762279-a389-41c9-9169-7ebc682e9703', 'guest_feedback', 'Quarterly Guest Feedback', 'Quarterly satisfaction trends and service improvement recommendations', NULL, 'Scheduled', 'PDF', 'Quarterly'),
  ('BE-GF-A', '18762279-a389-41c9-9169-7ebc682e9703', 'guest_feedback', 'Annual Guest Feedback', 'Annual guest satisfaction review with NPS and benchmarking', NULL, 'Failed', 'PDF', 'Annual')
ON CONFLICT DO NOTHING;
