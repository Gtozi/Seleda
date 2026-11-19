-- 452_banquet_reports.sql
--
-- Stores generated banquet/event report records so the Reports tab
-- can show real, persisted reports instead of hardcoded placeholders.
-- KPIs (event count, revenue, attendance) are computed live from
-- event_bookings, event_charges, and folio_payments.

CREATE TABLE IF NOT EXISTS public.banquet_event_reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  report_type text NOT NULL,           -- Event Summary | Revenue Report | Occupancy Analysis | Vendor Performance | Resource Utilization | Guest Feedback
  report_name text NOT NULL,
  date_range_start date,
  date_range_end date,
  status text NOT NULL DEFAULT 'Completed',  -- Completed | Generating | Failed
  generated_by text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb,                       -- computed KPIs snapshot at generation time
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_reports_type ON public.banquet_event_reports (report_type);
CREATE INDEX IF NOT EXISTS idx_banquet_reports_generated ON public.banquet_event_reports (generated_at DESC);

-- ── Seed mock report records ───────────────────────────────────────
INSERT INTO public.banquet_event_reports (property_id, report_type, report_name, date_range_start, date_range_end, status, generated_by, generated_at, summary) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Event Summary', 'Event Summary — September 2026', '2026-09-01', '2026-09-30', 'Completed', 'system', '2026-09-30 18:00:00+03', '{"totalEvents": 12, "completed": 5, "inProgress": 3, "upcoming": 4, "cancelled": 0, "totalAttendance": 1850, "byType": {"Conference": 3, "Wedding": 2, "Gala": 2, "Meeting": 2, "Social": 2, "Corporate": 1}}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Revenue Report', 'Revenue Report — Q3 2026', '2026-07-01', '2026-09-30', 'Completed', 'system', '2026-09-30 18:05:00+03', '{"totalRevenue": 28920, "totalCollected": 18300, "totalOutstanding": 10620, "byCategory": {"VenueRental": 14200, "Catering": 8900, "Beverage": 3200, "Equipment": 1800, "Decoration": 820}}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Occupancy Analysis', 'Occupancy Analysis — September 2026', '2026-09-01', '2026-09-30', 'Completed', 'system', '2026-09-30 18:10:00+03', '{"avgAttendance": 154, "expectedTotal": 1850, "actualTotal": 1420, "utilizationRate": 76.8, "peakDay": "2026-09-15", "peakAttendance": 320}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Vendor Performance', 'Vendor Performance — September 2026', '2026-09-01', '2026-09-30', 'Completed', 'system', '2026-09-30 18:15:00+03', '{"totalVendors": 8, "onTimeDelivery": 7, "qualityScore": 4.6, "issuesReported": 2, "topVendor": "Addis Floral Designs"}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Resource Utilization', 'Resource Utilization — September 2026', '2026-09-01', '2026-09-30', 'Completed', 'system', '2026-09-30 18:20:00+03', '{"venuesUsed": 5, "totalVenueHours": 180, "equipmentItems": 45, "avgUtilization": 72.5, "peakVenue": "Grand Ballroom"}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Guest Feedback', 'Guest Feedback — September 2026', '2026-09-01', '2026-09-30', 'Completed', 'system', '2026-09-30 18:25:00+03', '{"totalResponses": 145, "avgRating": 4.5, "satisfactionScore": 89.2, "complaints": 3, "recommendations": 142}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Event Summary', 'Event Summary — August 2026', '2026-08-01', '2026-08-31', 'Completed', 'system', '2026-08-31 18:00:00+03', '{"totalEvents": 8, "completed": 8, "inProgress": 0, "upcoming": 0, "cancelled": 1, "totalAttendance": 980, "byType": {"Conference": 2, "Wedding": 1, "Gala": 1, "Meeting": 2, "Social": 2}}'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Revenue Report', 'Revenue Report — August 2026', '2026-08-01', '2026-08-31', 'Completed', 'system', '2026-08-31 18:05:00+03', '{"totalRevenue": 18650, "totalCollected": 18650, "totalOutstanding": 0, "byCategory": {"VenueRental": 9200, "Catering": 5800, "Beverage": 2100, "Equipment": 1200, "Decoration": 350}}')
ON CONFLICT DO NOTHING;
