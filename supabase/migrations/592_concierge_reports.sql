-- Migration 592: Concierge reports registry
--
-- Backs /erp/concierge/reports. Mirrors the Housekeeping reports pattern
-- (hk_reports + HKReportsModule). Each row is a catalog entry whose data
-- is generated on demand by the /api/concierge/reports/:id/data endpoint
-- from live tables (guest_requests, folio_lines, vendors,
-- guest_communications, local_recommendations).

CREATE TABLE IF NOT EXISTS concierge_reports (
  id          text PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('operational','guest','revenue','service')),
  name        text NOT NULL,
  description text NOT NULL,
  last_run    timestamptz,
  status      text NOT NULL CHECK (status IN ('Ready','Scheduled','Generating','Failed')),
  format      text NOT NULL CHECK (format IN ('PDF','Excel','CSV')),
  frequency   text NOT NULL,
  property_id uuid REFERENCES properties(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Operational reports ──────────────────────────────────────────────────
INSERT INTO concierge_reports (id, category, name, description, last_run, status, format, frequency) VALUES
('daily-activity', 'operational', 'Daily Concierge Activity', 'Summary of concierge requests created in the selected period — volume by status and type.', now() - interval '6 hours', 'Ready', 'PDF', 'Daily'),
('request-analysis', 'operational', 'Guest Requests Analysis', 'Detailed breakdown of guest requests by type, status, and priority with full request listing.', now() - interval '1 day', 'Ready', 'Excel', 'Daily'),
('service-queue', 'operational', 'Service Queue Snapshot', 'Current open, assigned, and in-progress concierge requests with aging.', NULL, 'Scheduled', 'PDF', 'Hourly')
ON CONFLICT (id) DO NOTHING;

-- ── Guest reports ────────────────────────────────────────────────────────
INSERT INTO concierge_reports (id, category, name, description, last_run, status, format, frequency) VALUES
('guest-satisfaction', 'guest', 'Guest Satisfaction & Feedback', 'Ratings and written feedback from completed concierge requests.', now() - interval '2 days', 'Ready', 'PDF', 'Weekly'),
('vip-services', 'guest', 'VIP Services Report', 'VIP amenity and preparation requests — volume, status, and outcomes.', NULL, 'Scheduled', 'Excel', 'Daily'),
('communications', 'guest', 'Guest Communications Log', 'Messages by type and resolution status from the communication center.', now() - interval '12 hours', 'Ready', 'CSV', 'Daily')
ON CONFLICT (id) DO NOTHING;

-- ── Revenue reports ──────────────────────────────────────────────────────
INSERT INTO concierge_reports (id, category, name, description, last_run, status, format, frequency) VALUES
('charges-billing', 'revenue', 'Concierge Charges & Billing', 'Service charges posted to guest folios — totals, averages, and folio status.', now() - interval '8 hours', 'Ready', 'Excel', 'Daily'),
('vendor-performance', 'revenue', 'Vendor Performance', 'External service providers by category and status with outstanding balances.', now() - interval '1 day', 'Ready', 'PDF', 'Weekly'),
('experience-sales', 'revenue', 'Experience & Ticket Sales', 'Tour, ticket, shopping, and itinerary bookings with catalog pricing.', NULL, 'Failed', 'Excel', 'Weekly')
ON CONFLICT (id) DO NOTHING;

-- ── Service reports ──────────────────────────────────────────────────────
INSERT INTO concierge_reports (id, category, name, description, last_run, status, format, frequency) VALUES
('service-performance', 'service', 'Service Performance KPIs', 'Completion rate and average turnaround per request type.', now() - interval '1 day', 'Ready', 'PDF', 'Weekly'),
('itinerary-bookings', 'service', 'Itinerary & Bookings Report', 'Itinerary planning requests, statuses, and scheduled dates.', NULL, 'Scheduled', 'CSV', 'Daily'),
('recommendations-audit', 'service', 'Recommendations Coverage Audit', 'Local recommendations knowledge base coverage by category and rating.', now() - interval '3 days', 'Ready', 'CSV', 'Monthly')
ON CONFLICT (id) DO NOTHING;
