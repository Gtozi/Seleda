-- Migration 130: Sales Dashboard
-- Generic dashboard widgets for sales, marketing, and CRM KPIs plus chart data.

-- =============================================================
-- 1. Sales Dashboard widgets table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_dashboard (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  widget_type text NOT NULL DEFAULT 'kpi',
  category text,
  title text NOT NULL,
  value text,
  change_value text,
  sequence integer DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. updated_at trigger
-- =============================================================

DROP TRIGGER IF EXISTS trg_sales_dashboard_updated_at ON public.sales_dashboard;
CREATE TRIGGER trg_sales_dashboard_updated_at
  BEFORE UPDATE ON public.sales_dashboard
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 3. Performance indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_dashboard_type ON public.sales_dashboard(widget_type);
CREATE INDEX IF NOT EXISTS idx_sales_dashboard_category ON public.sales_dashboard(category);
CREATE INDEX IF NOT EXISTS idx_sales_dashboard_sequence ON public.sales_dashboard(sequence);

-- =============================================================
-- 4. Mock data
-- =============================================================

INSERT INTO public.sales_dashboard (id, widget_type, category, title, value, change_value, sequence, metadata) VALUES
  -- Sales KPIs
  ('mock-dash-001', 'kpi', 'sales', 'Revenue Pipeline', '$512,000', '+12%', 1, '{"icon":"TrendingUp","tone":"accent"}'),
  ('mock-dash-002', 'kpi', 'sales', 'Open Opportunities', '8', '+5', 2, '{"icon":"Target","tone":"info"}'),
  ('mock-dash-003', 'kpi', 'sales', 'Won Opportunities', '7', '+3', 3, '{"icon":"Award","tone":"success"}'),
  ('mock-dash-004', 'kpi', 'sales', 'Lost Opportunities', '2', '-1', 4, '{"icon":"Target","tone":"danger"}'),
  ('mock-dash-005', 'kpi', 'sales', 'Conversion Rate', '24.5%', '+2.4%', 5, '{"icon":"BarChart3","tone":"warning"}'),
  ('mock-dash-006', 'kpi', 'sales', 'Average Deal Size', '$73,143', '+8%', 6, '{"icon":"DollarSign","tone":"info"}'),
  ('mock-dash-007', 'kpi', 'sales', 'Corporate Revenue', '$128,000', '+15%', 7, '{"icon":"Building2","tone":"success"}'),
  ('mock-dash-008', 'kpi', 'sales', 'Repeat Guest %', '34%', '+5%', 8, '{"icon":"Users","tone":"accent"}'),

  -- Marketing KPIs
  ('mock-dash-009', 'kpi', 'marketing', 'Campaign Performance', '87%', null, 1, '{"icon":"Megaphone","tone":"success"}'),
  ('mock-dash-010', 'kpi', 'marketing', 'Lead Generation', '24', null, 2, '{"icon":"Target","tone":"info"}'),
  ('mock-dash-011', 'kpi', 'marketing', 'Email Open Rate', '42%', null, 3, '{"icon":"Mail","tone":"success"}'),
  ('mock-dash-012', 'kpi', 'marketing', 'Click Rate', '18%', null, 4, '{"icon":"MousePointerClick","tone":"warning"}'),
  ('mock-dash-013', 'kpi', 'marketing', 'Conversion Rate', '6.2%', null, 5, '{"icon":"BarChart3","tone":"info"}'),
  ('mock-dash-014', 'kpi', 'marketing', 'Cost per Lead', '$45', null, 6, '{"icon":"DollarSign","tone":"danger"}'),
  ('mock-dash-015', 'kpi', 'marketing', 'ROMI', '3.4x', null, 7, '{"icon":"TrendingUp","tone":"accent"}'),

  -- CRM KPIs
  ('mock-dash-016', 'kpi', 'crm', 'Active Loyalty Members', '1,247', null, 1, '{"icon":"Crown","tone":"warning"}'),
  ('mock-dash-017', 'kpi', 'crm', 'Guest Satisfaction', '4.6/5', null, 2, '{"icon":"Star","tone":"success"}'),
  ('mock-dash-018', 'kpi', 'crm', 'Net Promoter Score', '72', null, 3, '{"icon":"Heart","tone":"danger"}'),
  ('mock-dash-019', 'kpi', 'crm', 'Guest Lifetime Value', '$8,420', null, 4, '{"icon":"DollarSign","tone":"accent"}'),
  ('mock-dash-020', 'kpi', 'crm', 'Churn Rate', '8.3%', null, 5, '{"icon":"Activity","tone":"warning"}'),
  ('mock-dash-021', 'kpi', 'crm', 'Guest Retention', '91.7%', null, 6, '{"icon":"Users","tone":"info"}'),

  -- Chart data
  ('mock-dash-101', 'trend', 'sales', 'Revenue Trend', null, null, 1, '{"data":[
    {"month":"Jan","corporate":42000,"group":28000,"events":15000},
    {"month":"Feb","corporate":38000,"group":32000,"events":18000},
    {"month":"Mar","corporate":55000,"group":41000,"events":22000},
    {"month":"Apr","corporate":48000,"group":38000,"events":19000},
    {"month":"May","corporate":62000,"group":45000,"events":28000},
    {"month":"Jun","corporate":58000,"group":52000,"events":31000}
  ]}'),
  ('mock-dash-102', 'segment', 'sales', 'Customer Segments', null, null, 2, '{"data":[
    {"name":"Corporate","value":35,"color":"#6366f1"},
    {"name":"Leisure","value":28,"color":"#10b981"},
    {"name":"Group","value":18,"color":"#f59e0b"},
    {"name":"Travel Agent","value":12,"color":"#ec4899"},
    {"name":"Government","value":7,"color":"#06b6d4"}
  ]}')
ON CONFLICT (id) DO NOTHING;
