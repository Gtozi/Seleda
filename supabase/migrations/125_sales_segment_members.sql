-- Migration 125: Sales Customer Segmentation
-- Tracks customer segment assignments, spend, frequency, and value tiers.

-- =============================================================
-- 1. Sales Segment Members table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_segment_members (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name text NOT NULL,
  segment text NOT NULL,
  total_spend numeric DEFAULT 0,
  last_stay text,
  frequency text,
  value_tier text DEFAULT 'Medium',
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_segment_members_updated_at ON public.sales_segment_members;
CREATE TRIGGER trg_sales_segment_members_updated_at
  BEFORE UPDATE ON public.sales_segment_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_segment_members_segment ON public.sales_segment_members(segment);
CREATE INDEX IF NOT EXISTS idx_sales_segment_members_value_tier ON public.sales_segment_members(value_tier);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_segment_members (id, name, segment, total_spend, last_stay, frequency, value_tier, created_by) VALUES
  ('mock-segment-001', 'Ethiopian Airlines', 'Corporate Clients', 540000, '2026-08-20', 'Frequent', 'High', 'system'),
  ('mock-segment-002', 'KPMG Ethiopia', 'Corporate Clients', 210000, '2026-07-15', 'Regular', 'High', 'system'),
  ('mock-segment-003', 'Aster Demissie', 'Leisure Travelers', 185000, '2026-08-15', 'Occasional', 'High', 'system'),
  ('mock-segment-004', 'Bereket Solomon', 'Leisure Travelers', 112000, '2026-08-20', 'Regular', 'Medium', 'system'),
  ('mock-segment-005', 'Diaspora Reunion Group', 'Group Bookings', 78000, '2026-07-01', 'Annual', 'Medium', 'system'),
  ('mock-segment-006', 'Horizon Travel PLC', 'Travel Agents', 145000, '2026-08-10', 'Frequent', 'High', 'system'),
  ('mock-segment-007', 'Abyssinia Tour Operators', 'Travel Agents', 62000, '2026-06-20', 'Regular', 'Medium', 'system'),
  ('mock-segment-008', 'Meron Tadesse', 'Loyalty Members', 245000, '2026-09-01', 'Frequent', 'High', 'system'),
  ('mock-segment-009', 'Yared Tadesse', 'Loyalty Members', 42000, '2026-09-05', 'Occasional', 'Low', 'system'),
  ('mock-segment-010', 'Addis Events PLC', 'Event Organizers', 128000, '2026-08-25', 'Regular', 'High', 'system')
ON CONFLICT (id) DO NOTHING;
