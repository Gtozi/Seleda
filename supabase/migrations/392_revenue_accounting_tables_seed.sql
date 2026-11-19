-- Migration 392: Revenue Accounting tables + seed data
-- Backs the /erp/finance/revenue tab. Replaces the mock/placeholder data in
-- RevenueAccounting.tsx with persistent, DB-backed records.
-- Tables: revenue_entries, deferred_revenue, daily_posting_summaries,
--         package_allocations

-- ── revenue_entries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.revenue_entries (
  id              text PRIMARY KEY,
  date            date NOT NULL,
  source          text NOT NULL CHECK (source IN ('room','f_b','spa','laundry','transport','retail','events','misc')),
  amount          numeric DEFAULT 0,
  tax_amount      numeric DEFAULT 0,
  service_charge  numeric DEFAULT 0,
  net_amount      numeric DEFAULT 0,
  account_code    text,
  department      text,
  status          text DEFAULT 'recognized' CHECK (status IN ('recognized','deferred','accrued')),
  description     text,
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.revenue_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_entries TO authenticated;

INSERT INTO public.revenue_entries (id, date, source, amount, tax_amount, service_charge, net_amount, account_code, department, status, description, property_id)
VALUES
  ('rev_001', '2024-06-30', 'room',     85000, 12750, 4250, 68000, '4000-100', 'Front Office', 'recognized', 'Room revenue - June 30', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_002', '2024-06-30', 'f_b',      42000,  6300, 2100, 33600, '4000-200', 'F&B',          'recognized', 'F&B revenue - June 30',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_003', '2024-06-30', 'spa',       8500,  1275,  425,  6800, '4000-300', 'Spa',          'recognized', 'Spa revenue - June 30',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_004', '2024-06-30', 'laundry',   3200,   480,  160,  2560, '4000-400', 'Housekeeping', 'recognized', 'Laundry revenue - June 30','18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_005', '2024-06-30', 'events',   28000,  4200, 1400, 22400, '4000-700', 'Sales & Events','recognized', 'Wedding event - June 30','18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_006', '2024-06-29', 'room',     78000, 11700, 3900, 62400, '4000-100', 'Front Office', 'recognized', 'Room revenue - June 29', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_007', '2024-06-29', 'f_b',      38500,  5775, 1925, 30800, '4000-200', 'F&B',          'recognized', 'F&B revenue - June 29',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_008', '2024-06-29', 'transport',  1800,   270,   90,  1440, '4000-500', 'Front Office', 'recognized', 'Airport transfer - Jun 29','18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_009', '2024-06-29', 'retail',    2400,   360,  120,  1920, '4000-600', 'Gift Shop',   'recognized', 'Gift shop sales - Jun 29','18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_010', '2024-06-28', 'room',     82000, 12300, 4100, 65600, '4000-100', 'Front Office', 'recognized', 'Room revenue - June 28', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_011', '2024-06-28', 'f_b',      45000,  6750, 2250, 36000, '4000-200', 'F&B',          'recognized', 'Banquet F&B - June 28',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_012', '2024-06-28', 'events',   35000,  5250, 1750, 28000, '4000-700', 'Sales & Events','deferred',  'Conference booking - Jun 28','18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_013', '2024-06-27', 'room',     76000, 11400, 3800, 60800, '4000-100', 'Front Office', 'recognized', 'Room revenue - June 27', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_014', '2024-06-27', 'spa',       9200,  1380,  460,  7360, '4000-300', 'Spa',          'accrued',   'Spa packages - June 27', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_015', '2024-06-27', 'misc',      1500,   225,   75,  1200, '4000-800', 'Operations',   'recognized', 'Misc revenue - June 27', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── deferred_revenue ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deferred_revenue (
  id                  text PRIMARY KEY,
  description         text,
  original_amount     numeric DEFAULT 0,
  recognized_amount   numeric DEFAULT 0,
  remaining_amount    numeric DEFAULT 0,
  recognition_start   date,
  recognition_end     date,
  recognition_schedule jsonb,
  status              text DEFAULT 'Active' CHECK (status IN ('Active','Fully Recognized','Cancelled')),
  property_id         uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE public.deferred_revenue ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deferred_revenue TO authenticated;

INSERT INTO public.deferred_revenue (id, description, original_amount, recognized_amount, remaining_amount, recognition_start, recognition_end, recognition_schedule, status, property_id)
VALUES
  ('drev_001', 'Corporate prepaid - 12 month contract',  120000,  60000,  60000, '2024-01-01', '2024-12-31', '[{"month":"Jan","amount":10000},{"month":"Feb","amount":10000}]'::jsonb, 'Active',            '18762279-a389-41c9-9169-7ebc682e9703'),
  ('drev_002', 'Wedding deposit - September event',       45000,  15000,  30000, '2024-06-01', '2024-09-30', '[{"month":"Jun","amount":15000},{"month":"Jul","amount":15000}]'::jsonb, 'Active',            '18762279-a389-41c9-9169-7ebc682e9703'),
  ('drev_003', 'Conference prepaid - Q3 booking',         80000,  26667,  53333, '2024-07-01', '2024-09-30', '[{"month":"Jul","amount":26667}]'::jsonb, 'Active',            '18762279-a389-41c9-9169-7ebc682e9703'),
  ('drev_004', 'Gift card liability',                     25000,  10000,  15000, '2024-01-01', '2024-12-31', '[{"month":"Jan","amount":2000}]'::jsonb, 'Active',            '18762279-a389-41c9-9169-7ebc682e9703'),
  ('drev_005', 'Loyalty points liability',                18000,  18000,      0, '2024-01-01', '2024-06-30', '[]'::jsonb,                             'Fully Recognized',  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── daily_posting_summaries ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_posting_summaries (
  id              text PRIMARY KEY,
  posting_date    date NOT NULL,
  total_revenue   numeric DEFAULT 0,
  total_tax       numeric DEFAULT 0,
  total_service_charge numeric DEFAULT 0,
  total_net       numeric DEFAULT 0,
  entry_count     integer DEFAULT 0,
  status          text DEFAULT 'Posted' CHECK (status IN ('Draft','Posted','Reversed')),
  posted_by       text,
  posted_at       timestamptz,
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.daily_posting_summaries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_posting_summaries TO authenticated;

INSERT INTO public.daily_posting_summaries (id, posting_date, total_revenue, total_tax, total_service_charge, total_net, entry_count, status, posted_by, posted_at, property_id)
VALUES
  ('dps_001', '2024-06-30', 166700, 25005,  8335, 133360, 5, 'Posted', 'system', '2024-07-01 02:00:00+00', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dps_002', '2024-06-29', 120700, 18105,  6035,  96560, 4, 'Posted', 'system', '2024-06-30 02:00:00+00', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dps_003', '2024-06-28', 162000, 24300,  8100, 129600, 3, 'Posted', 'system', '2024-06-29 02:00:00+00', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dps_004', '2024-06-27',  86700, 13005,  4335,  69360, 3, 'Posted', 'system', '2024-06-28 02:00:00+00', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dps_005', '2024-06-26',  78000, 11700,  3900,  62400, 2, 'Draft',  NULL,    NULL,                     '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── package_allocations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_allocations (
  id              text PRIMARY KEY,
  package_name    text NOT NULL,
  total_amount    numeric DEFAULT 0,
  room_portion    numeric DEFAULT 0,
  fb_portion      numeric DEFAULT 0,
  spa_portion     numeric DEFAULT 0,
  other_portion   numeric DEFAULT 0,
  allocation_method text DEFAULT 'Percentage',
  status          text DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.package_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_allocations TO authenticated;

INSERT INTO public.package_allocations (id, package_name, total_amount, room_portion, fb_portion, spa_portion, other_portion, allocation_method, status, property_id)
VALUES
  ('pkg_001', 'Bed & Breakfast Package',     25000, 15000, 10000,     0,     0, 'Percentage', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pkg_002', 'Full Board Package',          32000, 16000, 16000,     0,     0, 'Percentage', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pkg_003', 'Spa & Stay Weekend',          45000, 25000,  8000, 12000,     0, 'Percentage', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pkg_004', 'All-Inclusive Resort Package',55000, 22000, 20000,  8000,  5000, 'Percentage', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pkg_005', 'Honeymoon Special',           38000, 20000,  6000, 10000,  2000, 'Percentage', 'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
