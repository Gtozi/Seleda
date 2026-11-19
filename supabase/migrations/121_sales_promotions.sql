-- Migration 121: Sales Promotions & Offers
-- Tracks promo codes, package promotions, seasonal discounts, and special offers.

-- =============================================================
-- 1. Sales Promotions table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_promotions (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name text NOT NULL,
  type text,
  code text,
  discount_percent numeric DEFAULT 0,
  start_date date,
  end_date date,
  uses integer DEFAULT 0,
  max_uses integer DEFAULT 0,
  revenue numeric DEFAULT 0,
  status text DEFAULT 'Draft',
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_promotions_updated_at ON public.sales_promotions;
CREATE TRIGGER trg_sales_promotions_updated_at
  BEFORE UPDATE ON public.sales_promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_promotions_status ON public.sales_promotions(status);
CREATE INDEX IF NOT EXISTS idx_sales_promotions_end_date ON public.sales_promotions(end_date);
CREATE INDEX IF NOT EXISTS idx_sales_promotions_code ON public.sales_promotions(code);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_promotions (id, name, type, code, discount_percent, start_date, end_date, uses, max_uses, revenue, status, created_by) VALUES
  ('mock-promo-001', 'Summer Escape 20% Off', 'Seasonal Discount', 'SUMMER20', 20, '2026-06-01', '2026-08-31', 342, 1000, 84000, 'Active', 'system'),
  ('mock-promo-002', 'Weekend Spa Package', 'Weekend Package', 'SPAWEEKEND', 15, '2026-09-01', '2026-11-30', 86, 500, 28000, 'Active', 'system'),
  ('mock-promo-003', 'Corporate Rate 2026', 'Corporate Discount', 'CORP2026', 25, '2026-01-01', '2026-12-31', 120, 2000, 145000, 'Active', 'system'),
  ('mock-promo-004', 'Early Bird Q4', 'Early Booking Offer', 'EARLYQ4', 12, '2026-07-01', '2026-09-30', 210, 800, 42000, 'Expired', 'system'),
  ('mock-promo-005', 'Last Minute Escape', 'Last Minute Offer', 'LASTMIN15', 15, '2026-09-09', '2026-09-15', 18, 100, 5400, 'Active', 'system'),
  ('mock-promo-006', 'Long Stay 7+ Nights', 'Long Stay Promotion', 'STAY7', 18, '2026-10-01', '2026-12-31', 0, 300, 0, 'Scheduled', 'system')
ON CONFLICT (id) DO NOTHING;
