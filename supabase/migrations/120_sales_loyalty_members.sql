-- Migration 120: Sales Loyalty Members
-- Tracks loyalty program enrollment, tiers, points, stays, spend, and redemptions.

-- =============================================================
-- 1. Sales Loyalty Members table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_loyalty_members (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  member_name text NOT NULL,
  tier text DEFAULT 'Bronze',
  points numeric DEFAULT 0,
  total_stays integer DEFAULT 0,
  total_spend numeric DEFAULT 0,
  rewards_redeemed integer DEFAULT 0,
  enrollment_date date,
  status text DEFAULT 'Active',
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_loyalty_members_updated_at ON public.sales_loyalty_members;
CREATE TRIGGER trg_sales_loyalty_members_updated_at
  BEFORE UPDATE ON public.sales_loyalty_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_loyalty_members_tier ON public.sales_loyalty_members(tier);
CREATE INDEX IF NOT EXISTS idx_sales_loyalty_members_status ON public.sales_loyalty_members(status);
CREATE INDEX IF NOT EXISTS idx_sales_loyalty_members_points ON public.sales_loyalty_members(points DESC);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_loyalty_members (id, member_name, tier, points, total_stays, total_spend, rewards_redeemed, enrollment_date, status, created_by) VALUES
  ('mock-loyalty-001', 'Aster Demissie', 'Platinum', 42500, 24, 185000, 12, '2022-03-15', 'Active', 'system'),
  ('mock-loyalty-002', 'Bereket Solomon', 'Gold', 28200, 16, 112000, 5, '2023-01-10', 'Active', 'system'),
  ('mock-loyalty-003', 'Hiwot Girma', 'Silver', 15400, 9, 62000, 3, '2023-08-22', 'Active', 'system'),
  ('mock-loyalty-004', 'Dawit Hailu', 'Gold', 31100, 19, 142000, 7, '2021-11-05', 'Active', 'system'),
  ('mock-loyalty-005', 'Liya Tesfaye', 'Bronze', 4200, 3, 18000, 1, '2025-02-14', 'Active', 'system'),
  ('mock-loyalty-006', 'Yared Tadesse', 'Silver', 18900, 11, 78000, 2, '2023-05-30', 'Active', 'system'),
  ('mock-loyalty-007', 'Meron Tadesse', 'Platinum', 56800, 31, 245000, 15, '2020-09-18', 'Active', 'system'),
  ('mock-loyalty-008', 'Kirubel Alemu', 'Bronze', 6100, 4, 25000, 0, '2024-12-01', 'Active', 'system')
ON CONFLICT (id) DO NOTHING;
