-- Migration 117: Sales Marketing Campaigns
-- Tracks marketing campaigns, budgets, leads, conversions, and performance.

-- =============================================================
-- 1. Sales Campaigns table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_campaigns (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  campaign_name text NOT NULL,
  campaign_type text,
  status text DEFAULT 'Draft',
  audience text,
  budget numeric DEFAULT 0,
  spent numeric DEFAULT 0,
  leads integer DEFAULT 0,
  conversions integer DEFAULT 0,
  start_date date,
  end_date date,
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_campaigns_updated_at ON public.sales_campaigns;
CREATE TRIGGER trg_sales_campaigns_updated_at
  BEFORE UPDATE ON public.sales_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_campaigns_status ON public.sales_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_sales_campaigns_start_date ON public.sales_campaigns(start_date);
CREATE INDEX IF NOT EXISTS idx_sales_campaigns_campaign_type ON public.sales_campaigns(campaign_type);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_campaigns (id, campaign_name, campaign_type, status, audience, budget, spent, leads, conversions, start_date, end_date, notes, created_by) VALUES
  ('mock-campaign-001', 'Summer Getaway Email', 'Email Campaign', 'Active', 'Past guests', 15000, 7200, 340, 28, '2026-06-01', '2026-08-31', 'Promoting summer room packages and F&B offers.', 'system'),
  ('mock-campaign-002', 'Corporate Roadshow', 'Corporate Campaign', 'Completed', 'Corporate accounts', 25000, 24800, 85, 12, '2026-03-01', '2026-05-31', 'On-site presentations to key Addis Ababa corporates.', 'system'),
  ('mock-campaign-003', 'Eid Holiday SMS', 'SMS Campaign', 'Scheduled', 'All opted-in guests', 5000, 0, 0, 0, '2026-09-15', '2026-09-25', 'Holiday room-only flash sale.', 'system'),
  ('mock-campaign-004', 'Loyalty Points Push', 'Loyalty Campaign', 'Active', 'Loyalty members', 8000, 3200, 210, 45, '2026-07-01', '2026-09-30', 'Double points for weekend stays.', 'system'),
  ('mock-campaign-005', 'Wedding Social Promo', 'Social Media Campaign', 'Active', 'Engaged couples', 12000, 8500, 420, 18, '2026-05-15', '2026-10-31', 'Instagram and Facebook wedding package ads.', 'system'),
  ('mock-campaign-006', 'Referral Discount', 'Referral Campaign', 'Paused', 'Existing guests', 6000, 1800, 95, 8, '2026-04-01', '2026-12-31', 'Paused for budget review.', 'system')
ON CONFLICT (id) DO NOTHING;
