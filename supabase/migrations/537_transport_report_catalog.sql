-- Transport report catalog expansion (spec §24)
-- Adds the remaining spec'd reports so the catalog covers all four categories.
-- Each name maps to a generator in transportReports.routes.ts.

INSERT INTO transport_reports (id, property_id, category, name, description, last_run, generated_by, status, format, frequency, size)
SELECT * FROM (VALUES
  ('RPT-009', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Operational', 'No-Show Report',
   'Trips where the guest never showed', NULL, 'System', 'Scheduled', 'CSV', 'Weekly', '—'),
  ('RPT-010', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Fleet', 'Maintenance & Downtime Report',
   'Maintenance requests, downtime days and cost per vehicle', NULL, 'System', 'Scheduled', 'CSV', 'Weekly', '—'),
  ('RPT-011', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Financial', 'Contractor Payments Report',
   'Contractor invoices, expected vs billed variance and payment status', NULL, 'System', 'Scheduled', 'CSV', 'Monthly', '—'),
  ('RPT-012', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Financial', 'Transportation Expense Report',
   'Fuel and maintenance spend by vehicle', NULL, 'System', 'Scheduled', 'CSV', 'Monthly', '—'),
  ('RPT-013', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Financial', 'Trip Profitability Report',
   'Revenue and revenue-per-km for completed trips', NULL, 'System', 'Scheduled', 'CSV', 'Monthly', '—'),
  ('RPT-014', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Performance', 'Driver Safety & Incident Report',
   'Incidents by driver/vehicle with computed safety scores', NULL, 'System', 'Scheduled', 'CSV', 'Monthly', '—')
) AS s(id, property_id, category, name, description, last_run, generated_by, status, format, frequency, size)
WHERE NOT EXISTS (
  SELECT 1 FROM transport_reports r
  WHERE r.property_id = s.property_id::uuid AND r.id = s.id
);
