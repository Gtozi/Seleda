-- ============================================================
-- Finance — Business Intelligence
-- (Migration 405)
-- ============================================================
-- Brings /erp/finance/bi fully online.
-- Creates:
--   • fin_bi_metrics       — KPI metrics (revenue, expenses, profit, etc.)
--   • fin_bi_trends        — monthly revenue/expense/profit trends
--   • fin_bi_ratios        — financial ratios (liquidity, profitability)
--   • fin_bi_forecasts     — forecast vs actual comparisons
--   • fin_bi_cost_analysis — budget vs actual cost by category
--   • fin_bi_aging         — AR/AP aging summaries
-- All tables are RLS-enabled and seeded with demo rows.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_bi_metrics
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_bi_metrics (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  display_name text,
  value numeric(15,2) NOT NULL DEFAULT 0,
  previous_value numeric(15,2) NOT NULL DEFAULT 0,
  change_percent numeric(8,2) NOT NULL DEFAULT 0,
  period text,
  unit text NOT NULL DEFAULT 'currency',
  category text NOT NULL DEFAULT 'overview',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bim_property ON public.fin_bi_metrics(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_bim_name ON public.fin_bi_metrics(name);
CREATE INDEX IF NOT EXISTS idx_fin_bim_category ON public.fin_bi_metrics(category);

ALTER TABLE public.fin_bi_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_bi_metrics" ON public.fin_bi_metrics;
CREATE POLICY "authenticated can CRUD fin_bi_metrics" ON public.fin_bi_metrics
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_bi_metrics" ON public.fin_bi_metrics;
CREATE POLICY "service_role all fin_bi_metrics" ON public.fin_bi_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_bi_metrics TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_bi_trends
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_bi_trends (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  period text NOT NULL,
  revenue numeric(15,2) NOT NULL DEFAULT 0,
  expenses numeric(15,2) NOT NULL DEFAULT 0,
  profit numeric(15,2) NOT NULL DEFAULT 0,
  period_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bit_property ON public.fin_bi_trends(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_bit_period ON public.fin_bi_trends(period);
CREATE INDEX IF NOT EXISTS idx_fin_bit_order ON public.fin_bi_trends(period_order);

ALTER TABLE public.fin_bi_trends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_bi_trends" ON public.fin_bi_trends;
CREATE POLICY "authenticated can CRUD fin_bi_trends" ON public.fin_bi_trends
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_bi_trends" ON public.fin_bi_trends;
CREATE POLICY "service_role all fin_bi_trends" ON public.fin_bi_trends
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_bi_trends TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_bi_ratios
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_bi_ratios (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  display_name text,
  value numeric(10,2) NOT NULL DEFAULT 0,
  benchmark numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'good' CHECK (status IN ('good','warning','critical')),
  category text NOT NULL DEFAULT 'liquidity',
  unit text NOT NULL DEFAULT 'ratio',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bir_property ON public.fin_bi_ratios(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_bir_category ON public.fin_bi_ratios(category);
CREATE INDEX IF NOT EXISTS idx_fin_bir_status ON public.fin_bi_ratios(status);

ALTER TABLE public.fin_bi_ratios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_bi_ratios" ON public.fin_bi_ratios;
CREATE POLICY "authenticated can CRUD fin_bi_ratios" ON public.fin_bi_ratios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_bi_ratios" ON public.fin_bi_ratios;
CREATE POLICY "service_role all fin_bi_ratios" ON public.fin_bi_ratios
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_bi_ratios TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. fin_bi_forecasts
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_bi_forecasts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  metric text NOT NULL,
  forecast numeric(15,2) NOT NULL DEFAULT 0,
  actual numeric(15,2) NOT NULL DEFAULT 0,
  variance numeric(15,2) NOT NULL DEFAULT 0,
  accuracy numeric(8,2) NOT NULL DEFAULT 0,
  period text,
  unit text NOT NULL DEFAULT 'currency',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bif_property ON public.fin_bi_forecasts(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_bif_period ON public.fin_bi_forecasts(period);
CREATE INDEX IF NOT EXISTS idx_fin_bif_metric ON public.fin_bi_forecasts(metric);

ALTER TABLE public.fin_bi_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_bi_forecasts" ON public.fin_bi_forecasts;
CREATE POLICY "authenticated can CRUD fin_bi_forecasts" ON public.fin_bi_forecasts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_bi_forecasts" ON public.fin_bi_forecasts;
CREATE POLICY "service_role all fin_bi_forecasts" ON public.fin_bi_forecasts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_bi_forecasts TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. fin_bi_cost_analysis
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_bi_cost_analysis (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  category text NOT NULL,
  budget numeric(15,2) NOT NULL DEFAULT 0,
  actual numeric(15,2) NOT NULL DEFAULT 0,
  variance numeric(15,2) NOT NULL DEFAULT 0,
  variance_percent numeric(8,2) NOT NULL DEFAULT 0,
  trend text NOT NULL DEFAULT 'Stable' CHECK (trend IN ('Increasing','Decreasing','Stable')),
  period text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bica_property ON public.fin_bi_cost_analysis(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_bica_category ON public.fin_bi_cost_analysis(category);
CREATE INDEX IF NOT EXISTS idx_fin_bica_period ON public.fin_bi_cost_analysis(period);

ALTER TABLE public.fin_bi_cost_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_bi_cost_analysis" ON public.fin_bi_cost_analysis;
CREATE POLICY "authenticated can CRUD fin_bi_cost_analysis" ON public.fin_bi_cost_analysis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_bi_cost_analysis" ON public.fin_bi_cost_analysis;
CREATE POLICY "service_role all fin_bi_cost_analysis" ON public.fin_bi_cost_analysis
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_bi_cost_analysis TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. fin_bi_aging
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_bi_aging (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  type text NOT NULL CHECK (type IN ('ar','ap')),
  bucket text NOT NULL,
  amount numeric(15,2) NOT NULL DEFAULT 0,
  period text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_bia_property ON public.fin_bi_aging(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_bia_type ON public.fin_bi_aging(type);
CREATE INDEX IF NOT EXISTS idx_fin_bia_bucket ON public.fin_bi_aging(bucket);

ALTER TABLE public.fin_bi_aging ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_bi_aging" ON public.fin_bi_aging;
CREATE POLICY "authenticated can CRUD fin_bi_aging" ON public.fin_bi_aging
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_bi_aging" ON public.fin_bi_aging;
CREATE POLICY "service_role all fin_bi_aging" ON public.fin_bi_aging
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_bi_aging TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_fin_bim_updated_at ON public.fin_bi_metrics;
CREATE OR REPLACE FUNCTION public.set_fin_bim_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_bim_updated_at BEFORE UPDATE ON public.fin_bi_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_bim_updated_at();

DROP TRIGGER IF EXISTS trg_fin_bit_updated_at ON public.fin_bi_trends;
CREATE OR REPLACE FUNCTION public.set_fin_bit_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_bit_updated_at BEFORE UPDATE ON public.fin_bi_trends
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_bit_updated_at();

DROP TRIGGER IF EXISTS trg_fin_bir_updated_at ON public.fin_bi_ratios;
CREATE OR REPLACE FUNCTION public.set_fin_bir_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_bir_updated_at BEFORE UPDATE ON public.fin_bi_ratios
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_bir_updated_at();

DROP TRIGGER IF EXISTS trg_fin_bif_updated_at ON public.fin_bi_forecasts;
CREATE OR REPLACE FUNCTION public.set_fin_bif_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_bif_updated_at BEFORE UPDATE ON public.fin_bi_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_bif_updated_at();

DROP TRIGGER IF EXISTS trg_fin_bica_updated_at ON public.fin_bi_cost_analysis;
CREATE OR REPLACE FUNCTION public.set_fin_bica_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_bica_updated_at BEFORE UPDATE ON public.fin_bi_cost_analysis
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_bica_updated_at();

DROP TRIGGER IF EXISTS trg_fin_bia_updated_at ON public.fin_bi_aging;
CREATE OR REPLACE FUNCTION public.set_fin_bia_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_bia_updated_at BEFORE UPDATE ON public.fin_bi_aging
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_bia_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 8. Seed demo data
-- ════════════════════════════════════════════════════════════════

-- Metrics
INSERT INTO public.fin_bi_metrics (property_id, name, display_name, value, previous_value, change_percent, period, unit, category) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'total_revenue', 'Total Revenue', 875000, 820000, 6.7, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'total_expenses', 'Total Expenses', 635000, 610000, 4.1, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'gross_profit', 'Gross Profit', 369000, 340000, 8.5, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'operating_profit', 'Operating Profit', 160000, 145000, 10.3, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'net_profit', 'Net Profit', 240000, 210000, 14.3, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ebitda', 'EBITDA', 195000, 178000, 9.6, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cash_position', 'Cash Position', 320000, 295000, 8.5, 'Q2 2024', 'currency', 'overview'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'bank_balance', 'Bank Balance', 450000, 425000, 5.9, 'Q2 2024', 'currency', 'overview')
ON CONFLICT (id) DO NOTHING;

-- Trends (12 months)
INSERT INTO public.fin_bi_trends (property_id, period, revenue, expenses, profit, period_order) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Jul 2023', 720000, 560000, 160000, 1),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Aug 2023', 745000, 575000, 170000, 2),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Sep 2023', 680000, 540000, 140000, 3),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Oct 2023', 710000, 555000, 155000, 4),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Nov 2023', 760000, 580000, 180000, 5),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Dec 2023', 820000, 610000, 210000, 6),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Jan 2024', 790000, 595000, 195000, 7),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Feb 2024', 815000, 605000, 210000, 8),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Mar 2024', 840000, 620000, 220000, 9),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Apr 2024', 860000, 625000, 235000, 10),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'May 2024', 855000, 630000, 225000, 11),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Jun 2024', 875000, 635000, 240000, 12)
ON CONFLICT (id) DO NOTHING;

-- Ratios
INSERT INTO public.fin_bi_ratios (property_id, name, display_name, value, benchmark, status, category, unit) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'current_ratio', 'Current Ratio', 1.85, 2.0, 'good', 'liquidity', 'ratio'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'quick_ratio', 'Quick Ratio', 1.42, 1.5, 'good', 'liquidity', 'ratio'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cash_ratio', 'Cash Ratio', 0.95, 1.0, 'warning', 'liquidity', 'ratio'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'gross_margin', 'Gross Margin', 42.5, 40.0, 'good', 'profitability', 'percent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'operating_margin', 'Operating Margin', 18.3, 15.0, 'good', 'profitability', 'percent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'net_profit_margin', 'Net Profit Margin', 12.7, 10.0, 'good', 'profitability', 'percent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'return_on_assets', 'Return on Assets', 8.2, 7.5, 'good', 'profitability', 'percent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'return_on_equity', 'Return on Equity', 15.4, 12.0, 'good', 'profitability', 'percent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'debt_to_equity', 'Debt to Equity', 0.68, 1.0, 'good', 'solvency', 'ratio'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'interest_coverage', 'Interest Coverage', 4.2, 3.0, 'good', 'solvency', 'ratio'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'asset_turnover', 'Asset Turnover', 0.85, 0.90, 'warning', 'efficiency', 'ratio'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'inventory_turnover', 'Inventory Turnover', 6.5, 8.0, 'critical', 'efficiency', 'ratio')
ON CONFLICT (id) DO NOTHING;

-- Forecasts
INSERT INTO public.fin_bi_forecasts (property_id, metric, forecast, actual, variance, accuracy, period, unit) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Revenue', 850000, 875000, 25000, 97.1, 'Q2 2024', 'currency'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Expenses', 620000, 635000, 15000, 97.6, 'Q2 2024', 'currency'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Net Profit', 230000, 240000, 10000, 95.8, 'Q2 2024', 'currency'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Occupancy Rate', 78, 82, 4, 95.1, 'Q2 2024', 'percent'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADR', 145, 152, 7, 95.4, 'Q2 2024', 'currency'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'RevPAR', 113, 125, 12, 90.4, 'Q2 2024', 'currency')
ON CONFLICT (id) DO NOTHING;

-- Cost Analysis
INSERT INTO public.fin_bi_cost_analysis (property_id, category, budget, actual, variance, variance_percent, trend, period) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Room Operations', 250000, 245000, -5000, -2.0, 'Decreasing', 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Food & Beverage', 180000, 195000, 15000, 8.3, 'Increasing', 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Staff Salaries', 320000, 325000, 5000, 1.6, 'Stable', 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Utilities', 45000, 48000, 3000, 6.7, 'Increasing', 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Maintenance', 35000, 32000, -3000, -8.6, 'Decreasing', 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Marketing', 28000, 30000, 2000, 7.1, 'Increasing', 'Q2 2024')
ON CONFLICT (id) DO NOTHING;

-- Aging
INSERT INTO public.fin_bi_aging (property_id, type, bucket, amount, period) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar', '0-30 Days', 45000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar', '31-60 Days', 23000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar', '61-90 Days', 12000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar', '90+ Days', 8000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap', '0-30 Days', 32000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap', '31-60 Days', 18000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap', '61-90 Days', 9000, 'Q2 2024'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap', '90+ Days', 5000, 'Q2 2024')
ON CONFLICT (id) DO NOTHING;
